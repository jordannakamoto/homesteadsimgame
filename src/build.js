/* Build mode. Talks to the world engine through window.__game and the window.__build hooks. */
(() => {
  const G = window.__game;
  if (!G) return;
  const T = G.THREE,
    P = G.player,
    W = G.world;
  const $ = (id) => document.getElementById(id);
  const canvas = G.renderer.domElement;

  const OP = window.__openings;
  const WALL_H = 2.7,
    FLOOR_T = 0.12,
    EAVE = 2.84,
    HALF_T = 0.1;
  const COST = { wall: 2, floor: 1, roof: 1, door: 2, window: 1 };
  const UNDO_DEPTH = 200;
  // Top-level tools, in the groups the bar shows them in. "tower" (a round room) is reached from Room's shape
  // option and "copy" from Select, so neither has a button of its own. cat is the bar slot a tool lives in
  // (select|shell|door|window|more|inside|remove: "more" and "inside" are group slots with a flyout), letter its
  // letter key, tip the longer explanation for the slot's title (the hint row keeps to one short sentence).
  const TOOLS = [
    { id: "select", name: "Select", key: "1", code: "Digit1", group: 0, cat: "select", letter: "V" },
    { id: "room", name: "Room", key: "2", code: "Digit2", group: 1, cat: "shell", letter: "R" },
    { id: "wall", name: "Wall", key: "3", code: "Digit3", group: 1, cat: "shell", letter: "N" },
    { id: "floor", name: "Floor", key: "4", code: "Digit4", group: 1, cat: "more", letter: "F" },
    { id: "roof", name: "Roof", key: "5", code: "Digit5", group: 1, cat: "shell", letter: "O" },
    { id: "door", name: "Door", key: "6", code: "Digit6", group: 2, cat: "door", letter: "J" },
    { id: "window", name: "Window", key: "7", code: "Digit7", group: 2, cat: "window", letter: "U" },
    { id: "stairs", name: "Stairs", key: "8", code: "Digit8", group: 2, cat: "more", letter: "Z" },
    { id: "pillar", name: "Pillar", key: "9", code: "Digit9", group: 2, cat: "more", letter: "P" },
    { id: "path", name: "Path", key: "0", code: "Digit0", group: 3, cat: "more", letter: "L" },
    { id: "decor", name: "Furnish", key: "F", code: "KeyF", group: 3, cat: "inside", letter: "C" },
    { id: "equip", name: "Equip", key: "E", code: "", group: 3, cat: "inside", letter: "E" },
    { id: "measure", name: "Measure", key: "U", code: "KeyU", group: 4, cat: "more", letter: "Y" },
    { id: "erase", name: "Remove", key: "X", code: "KeyX", group: 4, cat: "remove", letter: "X" },
  ];
  {
    const TIPS = {
      select: "Click a piece to select it. Shift-click adds, drag on open ground selects an area, drag a piece to move it. Double-click opens its details.",
      room: "Drag out a room: floor and walls in one go. Or click corner to corner. Type a number for an exact size.",
      wall: "Drag a wall at any angle, or click point to point. Drawing over a wall restyles it.",
      floor: "Drag out floor. Laying it over an old floor replaces the surface.",
      roof: "Click a room to roof it, or drag a rectangle. Click a roof to change it to this one. Enter roofs the whole building under the cursor.",
      door: "Point at a wall: the door follows along it and snaps to the centre and between openings. Click to hang it. Click one to select it, then drag its edges to resize or drag it to move. F flips the swing, Delete removes it.",
      window: "Point at a wall: the window follows the pointer, up and down too, and snaps to the usual sill, the centre and its neighbours' heads. Click to place. Click one to select it, then drag its edges to resize or drag it to move. Delete removes it.",
      stairs: "Drag from the foot of the stairs the way they should climb.",
      pillar: "Click to stand a pillar, or drag for an evenly spaced row. Pillars close together are joined by a beam.",
      path: "Drag a path over the ground, or click point to point.",
      decor: "Pick a piece, then click to place it. Wall pieces snap to walls.",
      equip: "Pick a piece of equipment and click to place it: on the ground, a floor, a wall or a roof. Drag from one port dot to another to run a wire or pipe.",
      measure: "Click two points to measure between them. Measurements stay until you clear them.",
      erase: "Click a piece to remove it, or drag a box to clear an area.",
    };
    for (const t of TOOLS) t.tip = TIPS[t.id];
  }

  const B = {
    on: false,
    tool: "select",
    free: true,
    structs: [],
    drag: null,
    hover: null,
    undo: [],
    redo: [],
    flip: false,
    levels: 1,
    level: 0,
    hs: 1,
    lift: 0,
    style: "wall",
    wstyle: "window",
    otype: "double_hung",
    osize: 1,
    osill: "auto",
    oflip: false,
    // the window designer's choices for the next window: a made-to-order size (w, h), frame colour, and look
    od: { w: null, h: null, finish: null, look: {} },
    // the Window and Door tools: the catalog type in hand for each, and whether a rustic module style is in hand instead
    owin: "double_hung",
    odoor: "door_single",
    wleg: false,
    dleg: false,
    odSave: {},
    ores: null,
    dlook: {},
    dfin: null,
    dnote: "",
    fsel: null,
    pkind: "pillar",
    dstyle: "door",
    // the roof in hand: shape, which way it is turned, pitch (inches per 12), overhangs in metres, gutters, finish
    rsh: "gable",
    rturn: 0,
    pitch12: 8,
    eave: 0.45,
    rake: 0.3,
    gutters: false,
    rcolor: null,
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
    rmat: "asphalt",
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
    // piece identity
    nextPid: 1,
    claim: null,
    // precision: snapping, typed values, measuring
    snap: true,
    ctrl: false,
    typed: { a: null, b: null },
    meas: [],
    measA: null,
    // remodeling
    sel: null,
    move: null,
    showRoofs: false,
    brush: "run",
    // what the interface shows; the counters tell it when to redraw
    uiVer: 1,
    ovVer: 1,
    hintText: "",
    fold: false,
    barH: 0,
    // construction: what new buildings stand on and are filled with, and whether plans start unbuilt
    found: "pier-blocks",
    ins: null,
    lining: "boards",
    // the finishes new buildings get (docs/design/interior-finishes.md): null, or { walls, faces, trim, items }
    deco: null,
    cmode: false,
    gstage: null,
    dirty: new Set(),
  };
  try {
    B.fold = localStorage.getItem("build:fold") === "1";
  } catch {}

  /* ---------- small helpers ---------- */
  const isWin = (t) => !!t && t.startsWith("window");
  const isArch = (t) => !!t && t.startsWith("arch");
  const isLow = (t) => t === "rail" || t === "railgate";
  const isDoor = (t) => t === "door" || t === "door2" || t === "railgate";
  const blocks = (t, isPlayer, low) => t === "wall" || t === "rail" || isWin(t) || (isDoor(t) && (!isPlayer || low));
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

  // inside a framed wall, between the studs: the back of the sheathing (src/build.js wall body, EK < 1)
  const OSB_PAL = { name: "Sheathing", plank: col(0xc9a468), beam: col(0xb48f58), stone: col(0xb48f58) };
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
    batten: { name: "Board and batten", plank: col(0xc7b79b), beam: col(0x6f5a47), stone: C.stone },
  };
  const PATHS = { cobble: { name: "Cobbles", c: col(0x8e8a80) }, dirt: { name: "Packed earth", c: col(0x8a6b47) }, gravel: { name: "Gravel", c: col(0xb5ad9c) }, boards: { name: "Boardwalk", c: col(0x9b7b4f) } };
  const FLOORS = { planks: { name: "Planks", c: C.floor }, flags: { name: "Flagstone", c: col(0x9a968c) }, dark: { name: "Dark boards", c: col(0x6b5238) }, tile: { name: "Clay tiles", c: col(0xb4654a), c2: col(0xc98a62) }, marble: { name: "Marble", c: col(0xd9d6cf), c2: col(0x4c4f55) }, cobble: { name: "Cobbles", c: col(0x86837b), c2: col(0x77746c) }, carpet: { name: "Red carpet", c: col(0x8c2f2c) }, moss: { name: "Lawn", c: col(0x5f8a3c) } };
  // Roof coverings. look: how the surface is drawn (courses of a given exposure in metres, standing seams, corrugations,
  // a flat membrane, a planted mat). min / max: the slopes it is laid at, as rise in inches per 12 of run (roofers' pitch).
  const ROOFS = {
    thatch: { name: "Thatch", c: C.thatch, group: "classic", look: "course", course: 0.5, lift: 0.06, alt: 0.035, butt: 0.08, min: 8, good: 12 },
    slate: { name: "Slate", c: col(0x56616c), group: "classic", look: "course", course: 0.42, min: 4 },
    tile: { name: "Clay tile", c: col(0xa9573b), group: "classic", look: "course", course: 0.4, alt: 0.03, min: 2.5 },
    shingle: { name: "Wood shingle", c: col(0x6a4f37), group: "classic", look: "course", course: 0.45, min: 3 },
    copper: { name: "Green copper", c: col(0x5fa08a), group: "classic", look: "course", course: 0.5, min: 3 },
    redslate: { name: "Red slate", c: col(0x7b3b3b), group: "classic", look: "course", course: 0.42, min: 4 },
    asphalt: { name: "Asphalt shingles", c: col(0x47494d), group: "modern", look: "course", course: 0.26, lift: 0.02, alt: 0.012, butt: 0.012, min: 2, good: 4, colors: ["charcoal", "weathered", "brown", "slateblue", "forest", "red"] },
    seam: { name: "Standing seam metal", c: col(0x3a3e43), group: "modern", look: "seam", min: 1, colors: ["charcoal", "black", "forest", "red", "slateblue", "bronze", "galvalume", "white"] },
    corrugated: { name: "Corrugated metal", c: col(0xa8aeb1), group: "modern", look: "corr", min: 3, colors: ["galvalume", "charcoal", "red", "forest"] },
    membrane: { name: "Rubber membrane", c: col(0x2b2c2e), group: "modern", look: "flat", min: 0.25 },
    green: { name: "Green roof", c: col(0x5f7f3c), group: "modern", look: "green", max: 3 },
  };
  // finishes a metal or shingle roof comes in
  const ROOF_COLORS = {
    charcoal: ["Charcoal", col(0x3a3e43)], black: ["Black", col(0x222326)], weathered: ["Weathered wood", col(0x6f6a62)], brown: ["Brown", col(0x5a4636)],
    slateblue: ["Slate blue", col(0x46566a)], forest: ["Forest green", col(0x334d3a)], red: ["Barn red", col(0x7d3027)], bronze: ["Bronze", col(0x5b4a37)],
    galvalume: ["Galvalume", col(0xa8aeb1)], white: ["White", col(0xdedcd6)],
  };
  const roofCol = (r) => {
    const M = ROOFS[r.mat || "thatch"] || ROOFS.thatch;
    return r.color && ROOF_COLORS[r.color] && M.colors && M.colors.includes(r.color) ? ROOF_COLORS[r.color][1] : M.c;
  };
  let PAL = WALLS.timber,
    RPAL = C.thatch;

  // What each appearance is taken to be built of: layers from the outside in (floors from the underside up),
  // thickness in metres. The names are plain material names for the registry to map; a later iteration lets
  // the player change a piece's layers (insulation in the stud bay, say), which is kept per piece.
  const LY = (material, thickness, role) => Object.freeze({ material, thickness, role });
  const FRAME_WALL = Object.freeze([LY("softwood-boards", 0.022, "cladding"), LY("air", 0.089, "cavity"), LY("softwood-boards", 0.019, "lining")]);
  const DAUB_WALL = Object.freeze([LY("lime-plaster", 0.02, "cladding"), LY("wattle-and-daub", 0.1, "infill"), LY("lime-plaster", 0.02, "lining")]);
  const solid = (m, t) => Object.freeze([LY(m, t, "structure")]);
  const MASONRY = { stone: "fieldstone", mossy: "fieldstone", sandstone: "sandstone", whitestone: "limestone", brick: "brick" };
  const ASSEMBLIES = {
    wall: { timber: FRAME_WALL, dark: FRAME_WALL, batten: FRAME_WALL, plaster: DAUB_WALL, halftimber: DAUB_WALL, stone: solid("fieldstone", 0.2), mossy: solid("fieldstone", 0.2), sandstone: solid("sandstone", 0.2), whitestone: solid("limestone", 0.2), brick: solid("brick", 0.215), log: solid("softwood-log", 0.2) },
    floor: {
      planks: Object.freeze([LY("air", 0.095, "joist-bay"), LY("softwood-boards", 0.025, "deck")]),
      dark: Object.freeze([LY("air", 0.095, "joist-bay"), LY("softwood-boards", 0.025, "deck")]),
      flags: Object.freeze([LY("sand", 0.04, "bedding"), LY("flagstone", 0.08, "finish")]),
      tile: Object.freeze([LY("lime-mortar", 0.09, "bedding"), LY("clay-tile", 0.03, "finish")]),
      marble: Object.freeze([LY("lime-mortar", 0.09, "bedding"), LY("marble", 0.03, "finish")]),
      cobble: Object.freeze([LY("sand", 0.04, "bedding"), LY("cobblestone", 0.08, "finish")]),
      carpet: Object.freeze([LY("air", 0.085, "joist-bay"), LY("softwood-boards", 0.025, "deck"), LY("wool-carpet", 0.01, "finish")]),
      moss: Object.freeze([LY("topsoil", 0.09, "bedding"), LY("turf", 0.03, "finish")]),
    },
    roof: {
      thatch: Object.freeze([LY("thatch", 0.3, "covering")]),
      slate: Object.freeze([LY("slate", 0.008, "covering"), LY("softwood-boards", 0.02, "deck"), LY("air", 0.14, "rafter-bay")]),
      redslate: Object.freeze([LY("slate", 0.008, "covering"), LY("softwood-boards", 0.02, "deck"), LY("air", 0.14, "rafter-bay")]),
      tile: Object.freeze([LY("clay-roof-tile", 0.015, "covering"), LY("softwood-boards", 0.02, "deck"), LY("air", 0.14, "rafter-bay")]),
      shingle: Object.freeze([LY("wood-shingle", 0.02, "covering"), LY("softwood-boards", 0.02, "deck"), LY("air", 0.14, "rafter-bay")]),
      copper: Object.freeze([LY("copper-sheet", 0.0007, "covering"), LY("softwood-boards", 0.02, "deck"), LY("air", 0.14, "rafter-bay")]),
      asphalt: Object.freeze([LY("asphalt-shingle", 0.007, "covering"), LY("softwood-boards", 0.02, "deck"), LY("air", 0.14, "rafter-bay")]),
      seam: Object.freeze([LY("steel-sheet", 0.0006, "covering"), LY("softwood-boards", 0.02, "deck"), LY("air", 0.14, "rafter-bay")]),
      corrugated: Object.freeze([LY("steel-sheet", 0.0005, "covering"), LY("softwood-boards", 0.02, "deck"), LY("air", 0.14, "rafter-bay")]),
      membrane: Object.freeze([LY("epdm-membrane", 0.0015, "covering"), LY("softwood-boards", 0.02, "deck"), LY("air", 0.14, "rafter-bay")]),
      green: Object.freeze([LY("topsoil", 0.08, "covering"), LY("epdm-membrane", 0.0015, "membrane"), LY("softwood-boards", 0.02, "deck"), LY("air", 0.14, "rafter-bay")]),
    },
    fence: Object.freeze([LY("softwood-rails", 0.07, "fence")]),
    leaf: Object.freeze([LY("softwood-boards", 0.045, "leaf")]),
    glazing: Object.freeze([LY("glass", 0.004, "glazing")]),
  };
  const sumT = (layers) => layers.reduce((a, l) => a + l.thickness, 0);
  function wallLayers(cls, mat) {
    if (cls === "rail") return ASSEMBLIES.fence;
    return ASSEMBLIES.wall[mat] || FRAME_WALL;
  }

  /* ---------- geometry ---------- */
  class Geo {
    constructor() {
      this.p = [];
      this.n = [];
      this.c = [];
    }
    tri(a, b, c, n, colr) {
      if (colr === GLASS_C && this.glass) return ((this.glass.yo = this.yo), this.glass.tri(a, b, c, n, colr));   // glass has its own mesh
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

  // box along a unit edge: t0..t1 along it, +-half across it. EK pulls the faces in: a wall clad with siding boards (stick
  // framed, its boards drawn as members) keeps its body behind them, so the two never share a depth and fight
  let EK = 1;
  function ebox(g, i, j, d, t0, t1, y0, y1, half, colr) {
    half *= EK;
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
    // the foot of the wall; behind a framed wall's lining and siding (EK < 1) it stays in, clear of the baseboard
    const foot = () => ebox(g, i, j, d, 0, 1, -depth, 0.3, EK < 1 ? 0.075 : 0.13, shade(PAL.stone, 0.92 + 0.16 * hash(i, j, d + 9)));
    const cap = () => ebox(g, i, j, d, 0, 1, WALL_H, EAVE, 0.095, PAL.beam);
    if (type === "railgate") {
      ebox(g, i, j, d, 0, 1, -depth, 0.04, 0.1, PAL.stone);
      for (const t of [0.045, 0.955]) ebox(g, i, j, d, t - 0.045, t + 0.045, 0.04, 1.14, 0.05, PAL.beam);
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
      ebox(g, i, j, d, 0.33, 0.67, 1.11, 1.89, 0.003, GLASS_C);
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
      ebox(g, i, j, d, 0, 1, -depth, 0.3, EK < 1 ? 0.075 : 0.13, shade(PAL.stone, 0.92 + 0.16 * hash(i, j, d + 9)));
      planks(0.3, 0.8);
      ebox(g, i, j, d, 0, 0.24, 0.8, WALL_H, 0.07, shade(PAL.plank, hs(0)));
      ebox(g, i, j, d, 0.76, 1, 0.8, WALL_H, 0.07, shade(PAL.plank, hs(3)));
      for (let k = 0; k < 6; k++) {
        const u0 = k / 6,
          u1 = (k + 1) / 6,
          yb = 1.78 + 0.42 * Math.sin(Math.PI * ((k + 0.5) / 6));
        ebox(g, i, j, d, 0.24 + 0.52 * u0, 0.24 + 0.52 * u1, yb, WALL_H, 0.07, shade(PAL.plank, hs(k % 4)));
        ebox(g, i, j, d, 0.24 + 0.52 * u0, 0.24 + 0.52 * u1, yb - 0.07, yb, 0.09, PAL.beam);
        ebox(g, i, j, d, 0.24 + 0.52 * u0, 0.24 + 0.52 * u1, 0.86, yb - 0.07, 0.003, GLASS_C);
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
      ebox(g, i, j, d, 0, 1, -depth, 0.3, EK < 1 ? 0.075 : 0.13, shade(PAL.stone, 0.92 + 0.16 * hash(i, j, d + 9)));
      if (type === "window") {
        planks(0.3, 1.05);
        planks(1.95, WALL_H);
        ebox(g, i, j, d, 0.04, 0.96, 1.03, 1.11, 0.11, PAL.beam);
        ebox(g, i, j, d, 0.04, 0.96, 1.89, 1.97, 0.1, PAL.beam);
        ebox(g, i, j, d, 0, 0.1, 1.05, 1.95, 0.09, PAL.beam);
        ebox(g, i, j, d, 0.9, 1, 1.05, 1.95, 0.09, PAL.beam);
        ebox(g, i, j, d, 0.475, 0.525, 1.11, 1.89, 0.03, PAL.beam);
        ebox(g, i, j, d, 0.1, 0.9, 1.475, 1.525, 0.03, PAL.beam);
        ebox(g, i, j, d, 0.1, 0.9, 1.11, 1.89, 0.003, GLASS_C);
      } else planks(0.3, WALL_H);
    }
    ebox(g, i, j, d, 0, 1, WALL_H, EAVE, 0.095, PAL.beam);
  }

  /* ---------- roofs: one geometry for drawing, framing and the plan ---------- */
  // Pitch is rise in inches per 12 of run, as roofers give it. Saves from before carry `pitch` as a multiplier instead.
  const ROOF_SHAPES = { gable: "Gable", hip: "Hip", gambrel: "Gambrel", saltbox: "Saltbox", shed: "Lean-to", flat: "Flat" };
  const ROOF_LONG = { gable: "Gable roof", hip: "Hip roof", gambrel: "Gambrel roof", saltbox: "Saltbox roof", shed: "Lean-to roof", flat: "Flat roof" };
  const RIDGED = { gable: 1, gambrel: 1, saltbox: 1 };
  const ROOF_HEEL = 0.1;
  const TURNS = { gable: 2, gambrel: 2, saltbox: 4, shed: 4 };
  const pitchOf = (r) => {
    const s = r.shape || "gable";
    if (s === "flat") return 0.25;
    if (r.pitch12 != null) return r.pitch12;
    if (s === "shed") return 5;
    const p = r.pitch || 1;
    return p >= 2 ? 16 : p > 1.2 ? 12 : 7;
  };
  const eaveOf = (r) => (r.eave != null ? r.eave : r.shape === "flat" ? 0.15 : 0.45);
  const rakeOf = (r) => (r.rake != null ? r.rake : 0.3);
  const degOf = (p12) => (Math.atan(p12 / 12) * 180) / Math.PI;
  const p12Text = (p) => (Math.round(p * 100) / 100) + "/12";

  // The parts of a rectangular roof, in the structure's own metres, heights as in a normal storey. The one description
  // that drawing (roofPieces), framing (roofMembers via frameOf) and the piece list all read:
  //  plane  { pts (outline in plan, eave edge first, overhangs included), eaveY, ridgeY, run (plan distance eave edge to
  //           top), facing (downslope, plan unit), eave, rake (overhang past the walls at the ends of the eave edge),
  //           drip (its eave edge is a real eave), outer (per edge pts[n]->pts[n+1]: a free edge), pitch12 }
  //  infill { a, b (on the wall line), y0, y1, area, shape, outline [[x, y, z]...] }  the wall under a gable or lean-to
  //  ridge  { a, b, y0, y1 }   hip { a, b, y0 (eave end), y1 (ridge end) }
  //  gutter { a, b (gutter centre line), y (its top), down (first downspout), downs, wall (where each meets the wall),
  //           out (outward unit), plane (index of its plane in this list) }
  function roofParts(r) {
    const x0 = r.i0,
      x1 = r.i1 + 1,
      z0 = r.j0,
      z1 = r.j1 + 1,
      shape = r.shape || "gable",
      s = pitchOf(r) / 12,
      e = eaveOf(r),
      k = rakeOf(r),
      // the roof sits on the walls with a heel: its deck passes over the top of the wall a little above it
      Y0 = EAVE + ROOF_HEEL,
      out = [];
    const plane = (pts, eaveY, ridgeY, run, facing, more) => out.push({ part: "plane", pts, eaveY, ridgeY, run, facing, eave: e, rake: 0, drip: true, outer: pts.map(() => false), pitch12: s * 12, ...more });
    let ends = k; // how far each gutter runs past the building's corner
    if (shape === "flat") {
      const y = EAVE + 0.1;
      ends = e;
      plane([[x0 - e, z0 - e], [x1 + e, z0 - e], [x1 + e, z1 + e], [x0 - e, z1 + e]], y, y, 0, [0, 0], { rake: e, outer: [true, true, true, true], pitch12: 0.25 });
    } else if (RIDGED[shape]) {
      const ax = r.axis === "x",
        P = (a, b) => (ax ? [a, b] : [b, a]),
        A0 = ax ? x0 : z0,
        A1 = ax ? x1 : z1,
        B0 = ax ? z0 : x0,
        B1 = ax ? z1 : x1,
        a0 = A0 - k,
        a1 = A1 + k,
        span = B1 - B0,
        half = span / 2;
      // the section across the ridge, wall to wall: [b, y] from B0 up and over to B1
      let prof;
      if (shape === "gambrel") {
        const w = half * 0.4,
          sl = clamp(s * 2.4, 1.2, 2.6),
          yb = Y0 + w * sl;
        prof = [[B0, Y0], [B0 + w, yb], [B0 + half, yb + (half - w) * s], [B1 - w, yb], [B1, Y0]];
      } else if (shape === "saltbox") {
        const short = span * 0.36,
          br = (r.dir || 0) & 1 ? B1 - short : B0 + short;
        prof = [[B0, Y0], [br, Y0 + short * s], [B1, Y0]];
      } else prof = [[B0, Y0], [B0 + half, Y0 + half * s], [B1, Y0]];
      const apex = shape === "gambrel" ? 2 : 1,
        top = prof[apex][1];
      const seg = (lo, hi, side, first) => {
        const sl = (hi[1] - lo[1]) / Math.abs(hi[0] - lo[0]),
          bE = first ? lo[0] + side * e : lo[0],
          yE = first ? lo[1] - sl * e : lo[1];
        plane([P(a0, bE), P(a1, bE), P(a1, hi[0]), P(a0, hi[0])], yE, hi[1], Math.abs(hi[0] - bE), P(0, side), { rake: k, drip: first, outer: [first, true, false, true], pitch12: sl * 12 });
      };
      for (let n = 0; n < apex; n++) seg(prof[n], prof[n + 1], -1, n === 0);
      for (let n = prof.length - 1; n > apex; n--) seg(prof[n], prof[n - 1], 1, n === prof.length - 1);
      // the wall under each end: up from the wall top to the underside of the roof
      const sec = [[B0, EAVE - 0.02], ...prof, [B1, EAVE - 0.02]];
      let area = 0;
      for (let n = 0; n < sec.length; n++) {
        const p = sec[n],
          q = sec[(n + 1) % sec.length];
        area += p[0] * q[1] - q[0] * p[1];
      }
      for (const a of [A0, A1])
        out.push({
          part: "infill", a: P(a, B0), b: P(a, B1), y0: EAVE - 0.02, y1: top, area: Math.abs(area) / 2, shape: prof.length === 3 ? "triangle" : "polygon",
          outline: sec.map(([b, y]) => { const [x, z] = P(a, b); return [x, y, z]; }),
        });
      out.push({ part: "ridge", a: P(a0 - 0.06, prof[apex][0]), b: P(a1 + 0.06, prof[apex][0]), y0: top, y1: top + 0.2 });
    } else if (shape === "hip") {
      const w = x1 - x0,
        l = z1 - z0,
        half = Math.min(w, l) / 2,
        ye = Y0 - s * e,
        yt = Y0 + half * s,
        run = half + e,
        c00 = [x0 - e, z0 - e],
        c10 = [x1 + e, z0 - e],
        c11 = [x1 + e, z1 + e],
        c01 = [x0 - e, z1 + e],
        r0 = w >= l ? [x0 + half, (z0 + z1) / 2] : [(x0 + x1) / 2, z0 + half],
        r1 = w >= l ? [x1 - half, (z0 + z1) / 2] : [(x0 + x1) / 2, z1 - half],
        ridge = Math.hypot(r1[0] - r0[0], r1[1] - r0[1]);
      ends = e;
      // eave edge first; a square plan has no ridge, so the long faces are triangles too
      const face = (e0, e1, p0, p1, facing) => (ridge > 1e-6 && p0 !== p1 ? plane([e0, e1, p1, p0], ye, yt, run, facing, { outer: [true, false, false, false] }) : plane([e0, e1, p0], ye, yt, run, facing, { outer: [true, false, false] }));
      if (w >= l) {
        face(c00, c10, r0, r1, [0, -1]);
        face(c11, c01, r1, r0, [0, 1]);
        face(c10, c11, r1, r1, [1, 0]);
        face(c01, c00, r0, r0, [-1, 0]);
      } else {
        face(c01, c00, r1, r0, [-1, 0]);
        face(c10, c11, r0, r1, [1, 0]);
        face(c00, c10, r0, r0, [0, -1]);
        face(c11, c01, r1, r1, [0, 1]);
      }
      if (ridge > 1e-6) out.push({ part: "ridge", a: r0, b: r1, y0: yt, y1: yt + 0.18 });
      const near0 = w >= l ? [c00, c01] : [c00, c10];
      for (const c of [c00, c10, c11, c01]) out.push({ part: "hip", a: c, b: near0.includes(c) ? r0 : r1, y0: ye, y1: yt });
    } else {
      // lean-to: one slope, running down in direction r.dir; the eave on the low side, the rake on the other three
      const [dx, dz] = DIRS[r.dir || 0],
        ax = dx !== 0,
        sgn = dx + dz,
        a0 = ax ? x0 : z0,
        a1 = ax ? x1 : z1,
        b0 = ax ? z0 : x0,
        b1 = ax ? z1 : x1,
        hi = sgn > 0 ? a0 : a1,
        lo = sgn > 0 ? a1 : a0,
        span = a1 - a0,
        rise = span * s,
        P = (a, b) => (ax ? [a, b] : [b, a]),
        eA = lo + sgn * e,
        tA = hi - sgn * k;
      plane([P(eA, b0 - k), P(eA, b1 + k), P(tA, b1 + k), P(tA, b0 - k)], Y0 - s * e, Y0 + rise + s * k, span + e + k, P(sgn, 0), { rake: k, outer: [true, true, true, true] });
      const V = (a, b, y) => {
        const [x, z] = P(a, b);
        return [x, y, z];
      };
      const lift = Y0 - EAVE + 0.02;
      for (const b of [b0, b1]) out.push({ part: "infill", a: P(a0, b), b: P(a1, b), y0: EAVE - 0.02, y1: Y0 + rise, area: span * (lift + rise / 2), shape: "triangle", outline: [V(lo, b, EAVE - 0.02), V(hi, b, EAVE - 0.02), V(hi, b, Y0 + rise), V(lo, b, Y0)] });
      out.push({ part: "infill", a: P(hi, b0), b: P(hi, b1), y0: EAVE - 0.02, y1: Y0 + rise, area: (b1 - b0) * (rise + lift), shape: "rectangle", outline: [V(hi, b0, EAVE - 0.02), V(hi, b1, EAVE - 0.02), V(hi, b1, Y0 + rise), V(hi, b0, Y0 + rise)] });
    }
    if (r.gutters) {
      const planes = out.filter((q) => q.part === "plane" && q.drip);
      for (const pl of planes) {
        const [p0, p1] = pl.pts,
          L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]),
          ev = [(p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L],
          o = pl.run ? pl.facing : [ev[1], -ev[0]],
          off = 0.07,
          a = [p0[0] + o[0] * off, p0[1] + o[1] * off],
          b = [p1[0] + o[0] * off, p1[1] + o[1] * off],
          at = (t) => [a[0] + ev[0] * t, a[1] + ev[1] * t],
          inset = Math.min(L / 2, ends + 0.12),
          downs = L > 9 ? [at(inset), at(L - inset)] : [at(inset)],
          back = pl.eave + off - 0.06;
        out.push({ part: "gutter", a, b, y: pl.eaveY - 0.03, down: downs[0], downs, wall: downs.map((d) => [d[0] - o[0] * back, d[1] - o[1] * back]), out: o, plane: out.indexOf(pl) });
      }
    }
    return out;
  }
  // the roof the tool has in hand, for a rectangle
  const ROOF_KEEP = ["shape", "axis", "dir", "pitch", "pitch12", "eave", "rake", "gutters", "color", "mat"];
  function roofFromHand(rect) {
    const sh = B.rsh,
      wide = rect.i1 - rect.i0 >= rect.j1 - rect.j0,
      t = B.rturn || 0,
      M = ROOFS[B.rmat] || ROOFS.thatch,
      r = { shape: sh, axis: RIDGED[sh] ? (wide !== !!(t & 1) ? "x" : "z") : wide ? "x" : "z", dir: sh === "shed" ? t & 3 : sh === "saltbox" ? (t >> 1) & 1 : 0, pitch12: sh === "flat" ? 0.25 : B.pitch12, eave: B.eave, rake: B.rake, gutters: !!B.gutters, mat: B.rmat };
    if (B.rcolor && M.colors && M.colors.includes(B.rcolor)) r.color = B.rcolor;
    return r;
  }
  // which way a roof is turned, as the tool counts it
  const turnOfRoof = (r) => {
    const sh = r.shape || "gable",
      wide = r.i1 - r.i0 >= r.j1 - r.j0;
    return sh === "shed" ? (r.dir || 0) & 3 : RIDGED[sh] ? (wide !== (r.axis === "x") ? 1 : 0) + (sh === "saltbox" ? ((r.dir || 0) & 1) * 2 : 0) : 0;
  };
  // pick up a roof's plan as the one in hand
  function takeRoof(r) {
    B.rsh = r.shape || "gable";
    B.rturn = turnOfRoof(r);
    if (B.rsh !== "flat") B.pitch12 = pitchOf(r);
    B.eave = eaveOf(r);
    B.rake = rakeOf(r);
    B.gutters = !!r.gutters;
    B.rcolor = r.color || null;
  }
  const sameRoofPlan = (a, b) =>
    (a.shape || "gable") === (b.shape || "gable") && (!RIDGED[a.shape || "gable"] || a.axis === b.axis) && (a.dir || 0) === (b.dir || 0) && pitchOf(a) === pitchOf(b) && eaveOf(a) === eaveOf(b) && rakeOf(a) === rakeOf(b) && !!a.gutters === !!b.gutters && (a.color || null) === (b.color || null) && (a.mat || "thatch") === (b.mat || "thatch");
  const roofRec = (r) => {
    const nr = { i0: r.i0, i1: r.i1, j0: r.j0, j1: r.j1 };
    for (const k of ROOF_KEEP) if (r[k] !== undefined && r[k] !== null) nr[k] = r[k];
    return nr;
  };
  // how much roofing a roof takes, measured on the slope, and the slopes it has
  function roofStats(r) {
    let area = 0,
      lo = 1e9,
      hi = 0,
      gut = 0,
      downs = 0;
    for (const q of roofParts({ ...r, gutters: true })) {
      if (q.part === "plane") {
        const kk = q.run ? (q.ridgeY - q.eaveY) / q.run : 0;
        area += polyArea(q.pts) * Math.sqrt(1 + kk * kk);
        lo = Math.min(lo, q.pitch12);
        hi = Math.max(hi, q.pitch12);
      } else if (q.part === "gutter") ((gut += Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1])), (downs += q.downs.length));
    }
    return { area, lo: lo > 1e8 ? 0 : lo, hi, gutterM: gut, downspouts: downs };
  }
  // what a roofer would say about laying this covering at these slopes, in plain words
  function roofWarnings(mat, lo, hi, eave) {
    const M = ROOFS[mat] || ROOFS.thatch,
      out = [],
      name = M.name.toLowerCase();
    if (M.min && lo < M.min - 1e-6) out.push({ text: "Too shallow for " + name, title: name[0].toUpperCase() + name.slice(1) + " needs " + p12Text(M.min) + " or steeper; this roof has " + p12Text(lo) + ". Water would back up under it." + (mat === "thatch" ? " Thatch really wants 45° (12/12)." : "") });
    else if (mat === "asphalt" && lo < 4 - 1e-6) out.push({ text: "Double underlayment", title: "Asphalt shingles below 4/12 need two layers of underlayment under them." });
    else if (mat === "thatch" && lo < 12 - 1e-6) out.push({ text: "Thatch wants 45°", title: "Thatch sheds water best at 12/12 (45°) or steeper; at " + p12Text(lo) + " it wears out sooner." });
    if (M.max && hi > M.max + 1e-6) out.push({ text: "Too steep for a green roof", title: "Green roofs are laid on low slopes, " + p12Text(M.max) + " or less; steeper, the soil slides off." });
    if (eave > 0.6 + 1e-6) out.push({ text: "Eave needs brackets", title: "An eave deeper than 0.6 m needs brackets or outlookers to carry it." });
    return out;
  }

  // ---- drawing, all of it from roofParts ----
  function clipHalf(poly, o, d, t, ge) {
    const out = [],
      f = (p) => ((p[0] - o[0]) * d[0] + (p[1] - o[1]) * d[1] - t) * (ge ? 1 : -1);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length],
        fa = f(a),
        fb = f(b);
      if (fa >= 0) out.push(a);
      if (fa >= 0 !== fb >= 0) {
        const u = fa / (fa - fb);
        out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
      }
    }
    return out;
  }
  const stripOf = (poly, o, d, t0, t1) => clipHalf(clipHalf(poly, o, d, t0, true), o, d, t1, false);
  const nrm3 = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const SEDUM = [col(0x5f8a3a), col(0x7a9a3e), col(0x4d7434), col(0x9aa64a), col(0x8a5040), col(0x6e8f46)];
  const GUTTER_C = col(0xe8e6e0);
  function roofPlane(g, pl, M, seed, trim) {
    const pts = pl.pts,
      e0 = pts[0],
      e1 = pts[1],
      EL = Math.hypot(e1[0] - e0[0], e1[1] - e0[1]) || 1,
      ev = [(e1[0] - e0[0]) / EL, (e1[1] - e0[1]) / EL];
    let up = [-pl.facing[0], -pl.facing[1]];
    if (!pl.run) {
      up = [-ev[1], ev[0]];
      if ((pts[2][0] - e0[0]) * up[0] + (pts[2][1] - e0[1]) * up[1] < 0) up = [ev[1], -ev[0]];
    }
    const kk = pl.run ? (pl.ridgeY - pl.eaveY) / pl.run : 0,
      cs = 1 / Math.sqrt(1 + kk * kk),
      n = [-up[0] * kk * cs, cs, -up[1] * kk * cs],
      down3 = [-up[0] * cs, -kk * cs, -up[1] * cs],
      tOf = (p) => (p[0] - e0[0]) * up[0] + (p[1] - e0[1]) * up[1],
      sOf = (p) => (p[0] - e0[0]) * ev[0] + (p[1] - e0[1]) * ev[1],
      P3 = (p, h) => [p[0] + n[0] * h, pl.eaveY + kk * tOf(p) + n[1] * h, p[1] + n[2] * h],
      fan = (poly, h, colr, nn) => {
        if (poly.length < 3) return;
        const A = poly.map((p) => P3(p, h));
        for (let i = 1; i + 1 < A.length; i++) g.tri(A[0], A[i], A[i + 1], nn || n, colr);
      };
    let T = 0;
    for (const p of pts) T = Math.max(T, tOf(p));
    T = T || 1;
    const look = M.look,
      top = look === "course" ? (M.lift || 0.03) + (M.alt || 0.025) : look === "green" ? 0.05 : 0.025,
      th = 0.13;
    if (look === "course") {
      // courses laid from the eave up, every other one a little proud, each with its butt edge showing
      const lift = M.lift || 0.03,
        alt = M.alt || 0.025,
        butt = M.butt || 0.02,
        nb = Math.max(1, Math.ceil(T / ((M.course || 0.45) * cs)));
      for (let b = 0; b < nb; b++) {
        const t0 = (T * b) / nb,
          t1 = Math.min(T, (T * (b + 1)) / nb + 0.02),
          poly = stripOf(pts, e0, up, t0, t1);
        if (poly.length < 3) continue;
        const h = lift + (b % 2) * alt,
          colr = shade(RPAL, 0.84 + 0.2 * hash(seed, b, 3) - 0.1 * (t0 / T));
        fan(poly, h, colr);
        const low = poly.filter((p) => Math.abs(tOf(p) - t0) < 1e-6);
        if (low.length >= 2) {
          low.sort((p, q) => sOf(p) - sOf(q));
          const a = low[0],
            c = low[low.length - 1],
            A = P3(a, h),
            C2 = P3(c, h),
            dd = butt + (b % 2) * alt;
          g.tri(A, C2, [C2[0] - n[0] * dd, C2[1] - n[1] * dd, C2[2] - n[2] * dd], down3, shade(colr, 0.7));
          g.tri(A, [C2[0] - n[0] * dd, C2[1] - n[1] * dd, C2[2] - n[2] * dd], [A[0] - n[0] * dd, A[1] - n[1] * dd, A[2] - n[2] * dd], down3, shade(colr, 0.7));
        }
      }
    } else if (look === "seam") {
      // panels about 0.45 m wide from eave to ridge, a raised seam between each pair
      const w = 0.45,
        np = Math.max(1, Math.round(EL / w)),
        pw = EL / np,
        up3 = [up[0] * cs, kk * cs, up[1] * cs];
      for (let m = 0; m < np; m++) fan(stripOf(pts, e0, ev, m * pw, (m + 1) * pw + 0.002), 0.02, shade(RPAL, 0.95 + 0.07 * hash(seed, m, 5)));
      for (let m = 0; m <= np; m++) {
        const sp = stripOf(pts, e0, ev, m * pw - 0.004, m * pw + 0.004);
        if (sp.length < 3) continue;
        let ta = 1e9,
          tb = -1e9;
        for (const p of sp) ((ta = Math.min(ta, tOf(p))), (tb = Math.max(tb, tOf(p))));
        if (tb - ta < 0.05) continue;
        const mid = [e0[0] + ev[0] * m * pw + up[0] * (ta + tb) / 2, e0[1] + ev[1] * m * pw + up[1] * (ta + tb) / 2],
          c = P3(mid, 0.042),
          hl = (tb - ta) / cs / 2;
        g.obox(c, [up3[0] * hl, up3[1] * hl, up3[2] * hl], [n[0] * 0.022, n[1] * 0.022, n[2] * 0.022], [ev[0] * 0.012, 0, ev[1] * 0.012], shade(RPAL, 1.12));
      }
    } else if (look === "corr") {
      // fine corrugations: narrow strips that turn alternately to and from the light
      const w = 0.07,
        ns = Math.max(2, Math.round(EL / w)),
        sw = EL / ns,
        evn = [ev[0], 0, ev[1]];
      for (let m = 0; m < ns; m++) {
        const tilt = m % 2 ? 0.45 : -0.45;
        fan(stripOf(pts, e0, ev, m * sw, (m + 1) * sw + 0.001), 0.02, shade(RPAL, m % 2 ? 1.05 : 0.86), nrm3([n[0] + evn[0] * tilt, n[1], n[2] + evn[2] * tilt]));
      }
    } else if (look === "flat") {
      const w = 1.5,
        ns = Math.max(1, Math.round(EL / w));
      for (let m = 0; m < ns; m++) fan(stripOf(pts, e0, ev, (m * EL) / ns, ((m + 1) * EL) / ns + 0.002), 0.025, shade(RPAL, 0.96 + 0.06 * hash(seed, m, 9)));
    } else if (look === "green") {
      // a sedum mat: a dark growing layer with low clumps all over it
      fan(pts, 0.03, shade(RPAL, 0.6));
      const st = 0.42,
        tri3 = (a, b, c, colr) => {
          const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
            v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
            nn = nrm3([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
          g.tri(a, b, c, nn[1] < 0 ? [-nn[0], -nn[1], -nn[2]] : nn, colr);
        };
      for (let si = 0; si * st < EL; si++)
        for (let ti = 0; ti * st < T; ti++) {
          const s = (si + 0.2 + 0.6 * hash(seed + si, ti, 11)) * st,
            t = (ti + 0.2 + 0.6 * hash(seed + ti, si, 12)) * st,
            p = [e0[0] + ev[0] * s + up[0] * t, e0[1] + ev[1] * s + up[1] * t];
          if (!pip(pts, p[0], p[1])) continue;
          const rr = 0.08 + 0.08 * hash(si, ti, seed),
            hh = 0.04 + 0.07 * hash(ti, si, seed + 1),
            colr = shade(SEDUM[Math.floor(hash(si, ti, seed + 2) * SEDUM.length)], 0.85 + 0.25 * hash(si, ti, 4)),
            q = (a, b) => P3([p[0] + ev[0] * a + up[0] * b, p[1] + ev[1] * a + up[1] * b], 0.03),
            apex = P3(p, 0.03 + hh),
            ring = [q(-rr, 0), q(0, -rr), q(rr, 0), q(0, rr)];
          for (let m = 0; m < 4; m++) tri3(ring[m], ring[(m + 1) % 4], apex, colr);
        }
    }
    // the edges you see: fascia on the eave, barge boards on the rakes, and the soffit under the overhang
    let cx = 0,
      cz = 0;
    for (const p of pts) ((cx += p[0] / pts.length), (cz += p[1] / pts.length));
    pts.forEach((a, i) => {
      if (!pl.outer[i]) return;
      const b = pts[(i + 1) % pts.length],
        L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      let o = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
      if (((a[0] + b[0]) / 2 - cx) * o[0] + ((a[1] + b[1]) / 2 - cz) * o[1] < 0) o = [-o[0], -o[1]];
      const A = P3(a, top),
        Bq = P3(b, top),
        on = [o[0], 0, o[1]];
      g.tri(A, Bq, [Bq[0], Bq[1] - th, Bq[2]], on, trim);
      g.tri(A, [Bq[0], Bq[1] - th, Bq[2]], [A[0], A[1] - th, A[2]], on, trim);
      if (!pl.run) {
        // a flat roof: a low upstand round the edge holds the membrane and the gravel in
        g.obox([(A[0] + Bq[0]) / 2 - o[0] * 0.035, A[1] + 0.04, (A[2] + Bq[2]) / 2 - o[1] * 0.035], [(Bq[0] - A[0]) / 2, 0, (Bq[2] - A[2]) / 2], [0, 0.05, 0], [-o[0] * 0.035, 0, -o[1] * 0.035], trim);
      }
    });
    const sof = pts.map((p) => {
      const q = P3(p, top);
      return [q[0], q[1] - th, q[2]];
    });
    for (let i = 1; i + 1 < sof.length; i++) g.tri(sof[0], sof[i], sof[i + 1], [-n[0], -n[1], -n[2]], shade(trim, 0.85));
  }
  // a square-section bar from p0 to p1 (downspouts)
  function rod(g, p0, p1, hw, colr) {
    const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]],
      L = Math.hypot(d[0], d[1], d[2]) || 1,
      u = [d[0] / L, d[1] / L, d[2] / L],
      ref = Math.abs(u[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0],
      a = nrm3([u[1] * ref[2] - u[2] * ref[1], u[2] * ref[0] - u[0] * ref[2], u[0] * ref[1] - u[1] * ref[0]]),
      b = [u[1] * a[2] - u[2] * a[1], u[2] * a[0] - u[0] * a[2], u[0] * a[1] - u[1] * a[0]];
    g.obox([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2], [d[0] / 2 + u[0] * hw, d[1] / 2 + u[1] * hw, d[2] / 2 + u[2] * hw], [a[0] * hw, a[1] * hw, a[2] * hw], [b[0] * hw, b[1] * hw, b[2] * hw], colr);
  }
  // a K-style gutter along the eave, falling gently to its downspouts, which come down the wall to the ground
  function gutterPiece(g, q, foot) {
    const L = Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]) || 1,
      ev = [(q.b[0] - q.a[0]) / L, (q.b[1] - q.a[1]) / L],
      o = q.out,
      fall = 0.004,
      ts = q.downs.map((d) => (d[0] - q.a[0]) * ev[0] + (d[1] - q.a[1]) * ev[1]),
      cuts = [0, ...(ts.length > 1 ? [L / 2] : []), L],
      W = 0.065,
      Hh = 0.055,
      c = GUTTER_C,
      dist = (t) => Math.min(...ts.map((s) => Math.abs(t - s))),
      maxD = Math.max(...cuts.map(dist)),
      // the gutter's top is highest farthest from a downspout
      yOf = (t) => q.y - fall * (maxD - dist(t));
    for (let m = 0; m + 1 < cuts.length; m++) {
      const t0 = cuts[m],
        t1 = cuts[m + 1],
        y0 = yOf(t0),
        y1 = yOf(t1),
        cx = q.a[0] + ev[0] * (t0 + t1) / 2,
        cz = q.a[1] + ev[1] * (t0 + t1) / 2,
        cy = (y0 + y1) / 2 - Hh,
        U = [(ev[0] * (t1 - t0)) / 2, (y1 - y0) / 2, (ev[1] * (t1 - t0)) / 2];
      g.obox([cx, cy - Hh + 0.008, cz], U, [0, 0.008, 0], [o[0] * W, 0, o[1] * W], c); // bottom
      g.obox([cx + o[0] * (W - 0.008), cy + 0.008, cz + o[1] * (W - 0.008)], U, [0, Hh + 0.008, 0], [o[0] * 0.008, 0, o[1] * 0.008], c); // front, with its lip
      g.obox([cx - o[0] * (W - 0.006), cy, cz - o[1] * (W - 0.006)], U, [0, Hh, 0], [o[0] * 0.006, 0, o[1] * 0.006], shade(c, 0.9)); // back
    }
    for (const t of [0, L]) {
      const y = yOf(t);
      g.obox([q.a[0] + ev[0] * t, y - Hh, q.a[1] + ev[1] * t], [ev[0] * 0.006, 0, ev[1] * 0.006], [0, Hh, 0], [o[0] * W, 0, o[1] * W], c); // end caps
    }
    const bottom = -(foot || 0.3) + 0.08;
    q.downs.forEach((d, n) => {
      const wl = q.wall[n],
        y = yOf(ts[n]) - 2 * Hh,
        top = [d[0], y, d[1]],
        neck = [d[0], y - 0.12, d[1]],
        atWall = [wl[0], y - 0.38, wl[1]],
        foot0 = [wl[0], bottom + 0.22, wl[1]],
        kick = [wl[0] + o[0] * 0.3, bottom, wl[1] + o[1] * 0.3];
      rod(g, top, neck, 0.04, c);
      rod(g, neck, atWall, 0.04, c);
      rod(g, atWall, foot0, 0.04, c);
      rod(g, foot0, kick, 0.04, c);
    });
  }
  function roofPieces(g, r, foot) {
    const M = ROOFS[r.mat || "thatch"] || ROOFS.thatch,
      seed = r.i0 * 3 + r.j0,
      trim = M.group === "modern" ? shade(RPAL, M.look === "green" ? 0.55 : 0.8) : PAL.beam,
      cap = M.group === "modern" ? shade(RPAL, M.look === "green" ? 0.5 : 0.85) : PAL.beam;
    roofParts(r).forEach((q, n) => {
      if (q.part === "plane") roofPlane(g, q, M, seed + n * 7, trim);
      else if (q.part === "ridge") {
        const L = Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]) || 1,
          u = [(q.b[0] - q.a[0]) / L, (q.b[1] - q.a[1]) / L];
        g.obox([(q.a[0] + q.b[0]) / 2, q.y0 + 0.09, (q.a[1] + q.b[1]) / 2], [(q.b[0] - q.a[0]) / 2, 0, (q.b[1] - q.a[1]) / 2], [0, 0.08, 0], [-u[1] * 0.11, 0, u[0] * 0.11], cap);
      } else if (q.part === "hip") {
        const a = [q.a[0], q.y0 + 0.07, q.a[1]],
          b = [q.b[0], q.y1 + 0.07, q.b[1]],
          L = Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]) || 1,
          u = [(q.b[0] - q.a[0]) / L, (q.b[1] - q.a[1]) / L];
        g.obox([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [(b[0] - a[0]) / 2, (b[1] - a[1]) / 2, (b[2] - a[2]) / 2], [0, 0.06, 0], [-u[1] * 0.08, 0, u[0] * 0.08], cap);
      } else if (q.part === "infill") {
        const L = Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]) || 1,
          nx = -(q.b[1] - q.a[1]) / L,
          nz = (q.b[0] - q.a[0]) / L,
          gc = shade(C.gable, 0.95),
          o7 = EK < 1 ? 0.04 : 0.07;        // a framed gable: in behind its sheathing and siding, which are the gable you see
        for (const off of [-o7, o7]) {
          const V = q.outline.map((p) => [p[0] + nx * off, p[1], p[2] + nz * off]);
          for (let i = 1; i + 1 < V.length; i++) g.tri(V[0], V[i], V[i + 1], [nx * Math.sign(off), 0, nz * Math.sign(off)], gc);
        }
      } else if (q.part === "gutter") gutterPiece(g, q, foot);
    });
  }
  const TOP_NAME = { cone: "Pointed roof", dome: "Dome" };

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
  const climbLevels = (r) => (ringInner(r) >= 1.7 ? r.h - 1 : 0);
  function ringPieces(g, rg, r, depth) {
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
        for (let l = 0; l < r.h; l++) freePiece(g, a[0], a[1], b[0], b[1], l === 0 ? ty : k % 3 === 1 ? "window" : "wall", l === 0 ? depth : 0, k * 5 + l, l * EAVE);
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
        const tk = (k + 0.5) / r.n;
        const tf = tk - Math.floor(tk);
        if (band === true && tf < 0.4) {
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
        const ang = r.rot + ((s + 0.5) / m) * TAU,
          cs = Math.cos(ang),
          sn = Math.sin(ang),
          y = ((s + 1) / m) * EAVE + FLOOR_T;
        g.obox([r.cx + cs * rm, y - 0.05, r.cz + sn * rm], [cs * 0.46, 0, sn * 0.46], [0, 0.05, 0], [-sn * hw, 0, cs * hw], shade(fc, 0.78 + 0.2 * hash(s, r.n, 9)));
      }
      for (let l = 1; l < r.h; l++) disc(g, l * EAVE + FLOOR_T, ri - 1.05, fc, l === climb ? true : null);
    }
    const shape = r.roof === true ? "cone" : r.roof;
    if (shape === "dome") {
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
  // walkable tops: the stairs and floors inside towers
  function topWalk(S, lx, lz, y) {
    let best = null;
    const H = EAVE * S.hs,
      ok = (hh) => {
        if (y >= S.y0 + hh - 0.65 && (best === null || hh > best)) best = hh;
      };
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
      } else {
        let raw = (Math.atan2(dz, dx) - r.rot) / (Math.PI * 2);
        raw -= Math.floor(raw);
        let th = raw - Math.floor(raw);
        for (let k = 0; k < L; k++) ok(stretchY((th + k) * EAVE + FLOOR_T, S.hs));
        th < 0.4 && ok(L * H + FLOOR_T);
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
  const DCATS = ["Home", "Fire and light", "Work and stores", "Village and garden", "Windows"];
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
    fireplace: { name: "Fireplace", cat: 1, cosy: 3, wall: 0.38, light: [0.7, 1.3], col: [[-0.5, 0, 0.5, 0]] },
    campfire: { name: "Campfire", cat: 1, light: [0.5, 1.2], col: PT },
    brazier: { name: "Brazier", cat: 1, cosy: 1, light: [1.1, 1], col: PT },
    candles: { name: "Candle stand", cat: 1, cosy: 1, light: [1.5, 0.6] },
    chandelier: { name: "Chandelier", cat: 1, cosy: 1, light: [-1.1, 1.1] },
    lamppost: { name: "Lamp post", cat: 1, light: [2.2, 1.2], col: PT },
    cauldron: { name: "Cooking pot", cat: 1, cosy: 1, light: [0.3, 0.5], col: PT },
    barrel: { name: "Barrel", cat: 2, col: PT },
    crate: { name: "Crate", cat: 2, col: PT },
    sacks: { name: "Sacks", cat: 2, col: PT },
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
    flag: { name: "Flag pole", cat: 3, col: PT },
    tent: { name: "Tent", cat: 3 },
    flowerbed: { name: "Flower bed", cat: 3 },
    bush: { name: "Bush", cat: 3, col: PT },
    // window dressing: hung on a window rather than set down (shut: the colour, or "none" to take them down)
    shut_black: { name: "Black shutters", cat: 4, shut: "black" },
    shut_green: { name: "Green shutters", cat: 4, shut: "green" },
    shut_red: { name: "Red shutters", cat: 4, shut: "red" },
    shut_blue: { name: "Blue shutters", cat: 4, shut: "blue" },
    shut_white: { name: "White shutters", cat: 4, shut: "white" },
    shut_wood: { name: "Wood shutters", cat: 4, shut: "wood" },
    shut_none: { name: "Take shutters down", cat: 4, shut: "none" },
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
    if (!S || !S.segs.length) return [];
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
      g.tri(v[0], v[1], v[2], [0, 1, 0], shade((FLOORS[p.fmat] || FLOORS.planks).c, 0.9 + 0.16 * hash(n, p.pts.length, 4)));
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


  // ---- free doors and windows (docs/FRAMING.md): a wall module with holes cut for them, and the unit that fills each
  const FRAME_C = [0.91, 0.89, 0.83],
    GLASS_C = [0.6, 0.76, 0.86],
    LEAF_C = col(0x6f4d2c);
  // a box in a free opening's own frame: u along the wall from the unit's left edge, y up, v across the wall
  // An opening's own frame: u along its wall from the unit's left edge, y up, v across. F is the opening record (or any
  // object with its fields): on a grid wall { d: 0 | 1, line, pos }, on an angled wall { d: "f", gx, gz, ux, uz, pos },
  // where (gx, gz) is the wall's start, (ux, uz) its direction and pos how far along it the unit's left edge is.
  const X3 = [1, 0, 0],
    Z3 = [0, 0, 1];
  function frameOf(F) {
    if (F.d === "f") return { U: [F.ux, 0, F.uz], V: [-F.uz, 0, F.ux], O: [F.gx + F.ux * F.pos, 0, F.gz + F.uz * F.pos] };
    return F.d === 0 ? { U: X3, V: Z3, O: [F.pos, 0, F.line] } : { U: Z3, V: X3, O: [F.line, 0, F.pos] };
  }
  const P3 = (F, u, y, v) => {
    const { U, V, O } = frameOf(F);
    return [O[0] + U[0] * u + V[0] * v, y, O[2] + U[2] * u + V[2] * v];
  };
  function lbox(g, F, u0, u1, y0, y1, v0, v1, colr) {
    const { U, V } = frameOf(F),
      hu = (u1 - u0) / 2,
      hv = (v1 - v0) / 2;
    if (colr === GLASS_C && g.glass) g = g.glass;   // glass goes to its own mesh (see glassMat)
    g.obox(P3(F, (u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2), [U[0] * hu, 0, U[2] * hu], [0, (y1 - y0) / 2, 0], [V[0] * hv, 0, V[2] * hv], colr);
  }
  // a convex outline in the opening's own (u, y) plane, given thickness from v0 to v1 across the wall
  function lpoly(g, F, pts, v0, v1, colr) {
    const glass = colr === GLASS_C && g.glass;
    if (glass) g = g.glass;
    const n = pts.length,
      FR = frameOf(F),
      nv = FR.V,
      A = pts.map((p) => P3(F, p[0], p[1], v1)),
      Bk = pts.map((p) => P3(F, p[0], p[1], v0));
    for (let i = 1; i + 1 < n; i++) (g.tri(A[0], A[i], A[i + 1], nv, colr), g.tri(Bk[0], Bk[i + 1], Bk[i], [-nv[0], 0, -nv[2]], colr));
    if (glass) return;
    let cu = 0,
      cy = 0;
    for (const p of pts) ((cu += p[0] / n), (cy += p[1] / n));
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n,
        du = pts[j][0] - pts[i][0],
        dy = pts[j][1] - pts[i][1],
        len = Math.hypot(du, dy);
      if (len < 1e-5) continue;
      let nu = dy / len,
        ny = -du / len;
      if (nu * (pts[i][0] - cu) + ny * (pts[i][1] - cy) < 0) ((nu = -nu), (ny = -ny));
      const N = [FR.U[0] * nu, ny, FR.U[2] * nu];
      g.tri(A[i], A[j], Bk[j], N, colr);
      g.tri(A[i], Bk[j], Bk[i], N, colr);
    }
  }
  // a bar from (u0, y0) to (u1, y1) in the opening's plane, th wide, v0 to v1 across the wall
  function lseg(g, F, u0, y0, u1, y1, th, v0, v1, colr) {
    const len = Math.hypot(u1 - u0, y1 - y0);
    if (len < 1e-4) return;
    const { U, V } = frameOf(F),
      au = (u1 - u0) / 2,
      ay = (y1 - y0) / 2,
      pu = (-(y1 - y0) / len) * (th / 2),
      py = ((u1 - u0) / len) * (th / 2),
      hv = (v1 - v0) / 2;
    g.obox(P3(F, (u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2), [U[0] * au, ay, U[2] * au], [U[0] * pu, py, U[2] * pu], [V[0] * hv, 0, V[2] * hv], colr);
  }
  // the part of a segment inside a rectangle (Liang-Barsky), or null
  function clipSeg(u0, y0, u1, y1, a, b, ya, yb) {
    let t0 = 0,
      t1 = 1;
    const du = u1 - u0,
      dy = y1 - y0;
    for (const [p, q] of [[-du, u0 - a], [du, b - u0], [-dy, y0 - ya], [dy, yb - y0]]) {
      if (Math.abs(p) < 1e-12) {
        if (q < 0) return null;
      } else {
        const r = q / p;
        if (p < 0) {
          if (r > t1) return null;
          if (r > t0) t0 = r;
        } else {
          if (r < t0) return null;
          if (r < t1) t1 = r;
        }
      }
    }
    return t1 - t0 < 1e-4 ? null : [u0 + du * t0, y0 + dy * t0, u0 + du * t1, y0 + dy * t1];
  }
  // just the fields that place an opening (its frame), from its record
  const fF = (f) => (f.d === "f" ? { d: "f", gx: f.gx, gz: f.gz, ux: f.ux, uz: f.uz, pos: f.pos } : { d: f.d, line: f.line, pos: f.pos });
  const FIN_C = {};
  const finishCol = (id) => FIN_C[id] || (FIN_C[id] = col((OP.FINISHES[id] || OP.FINISHES.white).hex));
  // The unit of a free opening, closed, in the opening's own frame: F = { d, line, pos }; sp is OP.freeSpec(f); flip
  // mirrors it along the wall; out is +1 when the outside of the wall is on the +v side. The frame goes to gF.
  // What moves (a leaf, a sash) goes by mode: "all" into gF too; "static" is left out; an array gets { geo, mv } for
  // each moving part, mv saying how it moves (swing, slide, tilt, rise, roll) so that the page can animate it.
  function unitGeo(gF, F, sp, flip, mode, out = 1) {
    const { w, h, type: t } = sp,
      door = t.kind === "door",
      y0 = door ? 0.02 : sp.sill,
      y1 = y0 + h,
      fw = 0.05,
      L = t.look;
    if (sp.leaf && OP.designable(t)) return designedDoorGeo(gF, F, sp, flip, mode, out);
    if (t.frame === "pocket") flip = false;
    const M = (a, b) => (flip ? [w - b, w - a] : [a, b]),
      mu = (u) => (flip ? w - u : u),
      // a drawer: (u0, u1, y0, y1, v0, v1, colour) draws a box; .seg draws a slanted bar, .poly a convex outline
      drawer = (g) => {
        const d = (a, b, ya, yb, va, vb, c) => g && lbox(g, F, ...M(a, b), ya, yb, va, vb, c);
        d.seg = (u0, y0, u1, y1, th, va, vb, c) => g && lseg(g, F, mu(u0), y0, mu(u1), y1, th, va, vb, c);
        d.poly = (pts, va, vb, c) => g && lpoly(g, F, pts.map((q) => [mu(q[0]), q[1]]), va, vb, c);
        return d;
      },
      fb = drawer(gF),
      mover = (mv) => {
        let g = null;
        if (mode === "all") g = gF;
        else if (Array.isArray(mode)) mode.push({ geo: (g = new Geo()), mv }), (g.glass = new Geo());
        return drawer(g);
      },
      leafC = door ? LEAF_C : FRAME_C;
    if (t.frame === "pocket") {
      // a pocket door shows its jambs: the leaf slides into the wall
      fb(0, fw, y0, y1, -0.07, 0.07, FRAME_C);
      fb(w - fw, w, y0, y1, -0.07, 0.07, FRAME_C);
      fb(0, w, y1 - fw, y1, -0.07, 0.07, FRAME_C);
      const pb = mover({ k: "slide", du: w - 2 * fw });
      pb(fw, w - fw, y0, y1 - fw, -0.02, 0.02, leafC);
      pb(w - 0.2, w - 0.17, y0 + 0.9, y0 + 1.1, 0.02, 0.035, [0.7, 0.62, 0.3]);
      return;
    }
    if (t.frame === "beam") {
      // a garage door: sectional panels with grooves, inside a plain trim
      fb(0, fw, y0, y1, -0.07, 0.07, FRAME_C);
      fb(w - fw, w, y0, y1, -0.07, 0.07, FRAME_C);
      fb(0, w, y1 - fw, y1, -0.07, 0.07, FRAME_C);
      const pb = mover({ k: "roll", top: y1 - fw, h: y1 - fw - y0 }),
        n = Math.max(2, L.grid[1]);
      for (let k = 0; k < n; k++) pb(fw, w - fw, y0 + ((y1 - fw - y0) * k) / n + 0.01, y0 + ((y1 - fw - y0) * (k + 1)) / n - 0.01, -0.03, 0.03, shade(FRAME_C, 0.96 - 0.04 * (k % 2)));
      return;
    }
    if (!door) return windowUnit(sp, w, y0, y1, flip, out, fb, mover);
    // the frame: jambs, head and (windows) sill
    fb(0, fw, y0, y1, -0.07, 0.07, FRAME_C);
    fb(w - fw, w, y0, y1, -0.07, 0.07, FRAME_C);
    fb(fw, w - fw, y1 - fw, y1, -0.07, 0.07, FRAME_C);
    if (!door) fb(fw, w - fw, y0, y0 + fw, -0.07, 0.07, FRAME_C);
    if (t.surface) {
      // a barn door hangs outside the wall on a track, over the opening, and slides along it
      const v0 = out > 0 ? 0.08 : -0.12,
        v1 = out > 0 ? 0.12 : -0.08,
        pb = mover({ k: "slide", du: (flip ? -1 : 1) * (w + 2 * t.leafOver + 0.05) });
      fb(-0.1, 2 * w + 0.2, y1 + 0.12, y1 + 0.16, out > 0 ? 0.07 : -0.1, out > 0 ? 0.1 : -0.07, [0.2, 0.2, 0.22]);
      pb(-t.leafOver, w + t.leafOver, y0, y1 + 0.06, v0, v1, leafC);
      pb(-t.leafOver, w + t.leafOver, y0 + (y1 - y0) * 0.5 - 0.04, y0 + (y1 - y0) * 0.5 + 0.04, out > 0 ? 0.12 : -0.135, out > 0 ? 0.135 : -0.12, shade(LEAF_C, 0.8));
      return;
    }
    const x0 = fw,
      x1 = w - fw,
      by = door ? y0 : y0 + fw,
      ty = y1 - fw,
      pn = t.id === "door_dutch" || t.op === "double_hung" ? 1 : Math.max(1, L.panels),
      grid = L.grid,
      rim = 0.04,
      dh = t.op === "double_hung";
    // one glazed or solid panel, drawn through pb (a moving part's drawer, or the frame's)
    const panel = (pb, a, b, ya, yb, zOff, solid) => {
      if (solid) {
        pb(a, b, ya, yb, zOff - 0.025, zOff + 0.025, leafC);
        pb(a + rim, b - rim, ya + (yb - ya) * 0.62, yb - rim, zOff - 0.03, zOff + 0.03, GLASS_C);
        return;
      }
      pb(a, a + rim, ya, yb, zOff - 0.025, zOff + 0.025, leafC);
      pb(b - rim, b, ya, yb, zOff - 0.025, zOff + 0.025, leafC);
      pb(a + rim, b - rim, ya, ya + rim, zOff - 0.025, zOff + 0.025, leafC);
      pb(a + rim, b - rim, yb - rim, yb, zOff - 0.025, zOff + 0.025, leafC);
      pb(a + rim, b - rim, ya + rim, yb - rim, zOff - 0.008, zOff + 0.008, GLASS_C);
      const gx = dh ? grid[0] : grid[0],
        gy = dh ? Math.max(1, Math.round(grid[1] / 2)) : grid[1];
      for (let k = 1; k < gx; k++) pb(a + ((b - a) * k) / gx - 0.008, a + ((b - a) * k) / gx + 0.008, ya + rim, yb - rim, zOff - 0.02, zOff + 0.02, leafC);
      for (let k = 1; k < gy; k++) pb(a + rim, b - rim, ya + ((yb - ya) * k) / gy - 0.008, ya + ((yb - ya) * k) / gy + 0.008, zOff - 0.02, zOff + 0.02, leafC);
    };
    if (dh) {
      // two sashes one over the other: the lower one rises
      const mid = (by + ty) / 2;
      panel(fb, x0, x1, mid - 0.02, ty, -0.035, false);
      panel(mover({ k: "rise", dy: (ty - by) * 0.42 }), x0, x1, by, mid + 0.02, 0.035, false);
      return;
    }
    const sdoor = door && t.id !== "door_french" && t.id !== "door_patio";
    for (let p = 0; p < pn; p++) {
      const a = x0 + ((x1 - x0) * p) / pn + (p ? 0.01 : 0),
        b = x0 + ((x1 - x0) * (p + 1)) / pn - (p < pn - 1 ? 0.01 : 0),
        zOff = t.op === "slide" ? (p % 2 ? 0.035 : -0.035) : 0;
      let mv = null;
      if (t.op === "swing" || t.op === "dutch") mv = { k: "swing", pu: mu(pn === 2 ? (p ? w : 0) : 0), s: pn === 2 ? (p ? -1 : 1) * (flip ? -1 : 1) : flip ? -1 : 1, ang: 1.5, side: -out };
      else if (t.op === "casement") mv = { k: "swing", pu: mu(0), s: flip ? -1 : 1, ang: 1.15, side: out };
      else if (t.op === "slide" && p === 1) mv = { k: "slide", du: -(b - a) * (flip ? -1 : 1) };
      else if (t.op === "awning") mv = { k: "tilt", py: ty, e: -1, ang: 0.85, side: out };
      else if (t.op === "tilt_in") mv = { k: "tilt", py: by, e: 1, ang: 0.6, side: -out };
      panel(mv ? mover(mv) : fb, a, b, by, ty, zOff, sdoor);
      if (sdoor && p === 0) (mv ? mover(mv) : fb)(w - 0.16, w - 0.12, y0 + 0.95, y0 + 1.05, -0.06, 0.06, [0.7, 0.62, 0.3]);
    }
    if (L.arch) fb(x0, x1, ty - 0.01, ty, -0.03, 0.03, FRAME_C);
  }
  // ---- a window as the window designer sets it (src/sim/content/openings.js: look, finish): the frame round its
  // outline (a rectangle, a round top, a pointed arch, a half or a whole circle), panes between mullions, the sashes that
  // open, the grille over the glass, a classic sill and shutters. Glass is drawn with GLASS_C and so lands in the glass mesh.
  function windowUnit(sp, w, y0, y1, flip, out, fb, mover) {
    const L = sp.look,
      t = sp.type,
      FC = finishCol(sp.finish),
      slim = !!L.slim,
      fw = slim ? 0.04 : 0.055,
      fd = 0.07,
      shape = L.shape || "rect",
      x0 = fw,
      x1 = w - fw,
      by = y0 + fw,
      ty = y1 - fw,
      cx = w / 2,
      hw = (x1 - x0) / 2,
      mt = slim ? 0.007 : 0.0095,
      nx = (u) => clamp((u - cx) / hw, -1, 1),
      sq = (u) => Math.sqrt(Math.max(0, 1 - nx(u) ** 2));
    let topAt = () => ty,
      botAt = () => by;
    if (shape === "arch") {
      const r = Math.min(hw, (ty - by) * 0.45);
      topAt = (u) => ty - r + r * sq(u);
    } else if (shape === "gothic") {
      const r = Math.min(hw * 1.732, (ty - by) * 0.6);
      topAt = (u) => ty - r + (r * Math.sqrt(Math.max(0, 4 - (Math.abs(nx(u)) + 1) ** 2))) / 1.732;
    } else if (shape === "half") topAt = (u) => by + (ty - by) * sq(u);
    else if (shape === "round") {
      const cy = (by + ty) / 2,
        ry = (ty - by) / 2;
      topAt = (u) => cy + ry * sq(u);
      botAt = (u) => cy - ry * sq(u);
    }
    // the grille over one pane (a, b, ya, yb) at depth z; part is "top" or "bottom" for a double-hung sash, else "all"
    const grille = (d, a, b, ya, yb, z, part) => {
      const G = L.grille,
        gx = Math.max(1, L.grid[0] | 0),
        gy0 = Math.max(1, L.grid[1] | 0),
        dhs = part !== "all",
        gy = dhs ? Math.max(1, Math.round(gy0 / 2)) : gy0,
        vb = (u, p, q) => d(u - mt, u + mt, p, q, z - 0.02, z + 0.02, FC),
        hb = (y, p, q) => d(p, q, y - mt, y + mt, z - 0.02, z + 0.02, FC),
        sb = (s) => s && d.seg(s[0], s[1], s[2], s[3], 2 * mt, z - 0.02, z + 0.02, FC);
      if (G === "none" || b - a < 0.08 || yb - ya < 0.08) return;
      if (G === "colonial" || (G === "cottage" && dhs && part === "top")) {
        for (let k = 1; k < gx; k++) vb(a + ((b - a) * k) / gx, ya, yb);
        for (let k = 1; k < gy; k++) hb(ya + ((yb - ya) * k) / gy, a, b);
      } else if (G === "cottage" && !dhs) {
        const yc = yb - (yb - ya) * 0.36;
        hb(yc, a, b);
        for (let k = 1; k < gx; k++) vb(a + ((b - a) * k) / gx, yc, yb);
      } else if (G === "farmhouse") {
        vb((a + b) / 2, ya, yb);
        dhs || hb((ya + yb) / 2, a, b);
      } else if (G === "craftsman") {
        const n = Math.max(2, gx);
        if (dhs) {
          if (part === "top") for (let k = 1; k < n; k++) vb(a + ((b - a) * k) / n, ya, yb);
        } else {
          const yc = yb - (yb - ya) * 0.34;
          hb(yc, a, b);
          for (let k = 1; k < n; k++) vb(a + ((b - a) * k) / n, yc, yb);
        }
      } else if (G === "prairie") {
        if (part === "bottom") return;
        const e = Math.min(0.09, 0.2 * Math.min(b - a, yb - ya));
        vb(a + e, ya, yb);
        vb(b - e, ya, yb);
        hb(ya + e, a, b);
        hb(yb - e, a, b);
      } else if (G === "diamond") {
        const sx = (b - a) / Math.max(1, gx),
          syy = (yb - ya) / Math.max(1, gy),
          n = gx + gy + 2;
        for (let k = -n; k <= n; k++) {
          sb(clipSeg(a + (k + n) * sx, ya - n * syy, a + (k - n) * sx, ya + n * syy, a, b, ya, yb));
          sb(clipSeg(a + (k - n) * sx, ya - n * syy, a + (k + n) * sx, ya + n * syy, a, b, ya, yb));
        }
      } else if (G === "sunburst") {
        const c0 = (a + b) / 2,
          R = Math.hypot(b - a, yb - ya),
          r0 = Math.min((b - a) * 0.13, (yb - ya) * 0.28),
          n = Math.max(4, gx + 3);
        for (let k = 1; k < n; k++) {
          const ang = (Math.PI * k) / n,
            c = Math.cos(ang),
            sn = Math.sin(ang);
          sb(clipSeg(c0 + c * r0, ya + sn * r0, c0 + c * R, ya + sn * R, a, b, ya, yb));
        }
        for (let k = 0; k < 6; k++) {
          const p = (Math.PI * k) / 6,
            q = (Math.PI * (k + 1)) / 6;
          sb(clipSeg(c0 + Math.cos(p) * r0, ya + Math.sin(p) * r0, c0 + Math.cos(q) * r0, ya + Math.sin(q) * r0, a, b, ya, yb));
        }
      }
    };
    // a sash: rails round a pane of glass, and its grille
    const rim = slim ? 0.032 : 0.045;
    const sash = (d, a, b, ya, yb, z, part) => {
      d(a, a + rim, ya, yb, z - 0.025, z + 0.025, FC);
      d(b - rim, b, ya, yb, z - 0.025, z + 0.025, FC);
      d(a + rim, b - rim, ya, ya + rim, z - 0.025, z + 0.025, FC);
      d(a + rim, b - rim, yb - rim, yb, z - 0.025, z + 0.025, FC);
      d(a + rim, b - rim, ya + rim, yb - rim, z - 0.003, z + 0.003, GLASS_C);
      grille(d, a + rim, b - rim, ya + rim, yb - rim, z, part);
    };
    // classic: a sill that sticks out under the window, and shutters either side
    if (!slim && shape !== "round") fb(-0.035, w + 0.035, y0 - 0.035, y0 + 0.004, out > 0 ? -fd : -0.125, out > 0 ? 0.125 : fd, FC);
    if (L.shutters && L.shutters !== "none" && (shape === "rect" || shape === "arch") && w < 2.2) {
      const SC = finishCol(L.shutters),
        sw = Math.min(0.75, w / 2),
        gap = 0.04,
        va = out > 0 ? 0.08 : -0.105,
        vv = out > 0 ? 0.105 : -0.08,
        h = y1 - y0,
        n = Math.max(3, Math.floor((h - 0.14) / 0.075));
      for (const [a, b] of [[-gap - sw, -gap], [w + gap, w + gap + sw]]) {
        fb(a, a + 0.055, y0, y1, va, vv, SC);
        fb(b - 0.055, b, y0, y1, va, vv, SC);
        fb(a + 0.055, b - 0.055, y0, y0 + 0.07, va, vv, SC);
        fb(a + 0.055, b - 0.055, y1 - 0.07, y1, va, vv, SC);
        fb(a + 0.055, b - 0.055, y0 + h * 0.48, y0 + h * 0.48 + 0.06, va, vv, SC);
        for (let k = 0; k < n; k++) {
          const yy = y0 + 0.07 + ((h - 0.14) * (k + 0.5)) / n;
          fb(a + 0.055, b - 0.055, yy - 0.024, yy + 0.024, va + (out > 0 ? 0.004 : -0.006), vv + (out > 0 ? 0.006 : -0.004), shade(SC, 0.78 + 0.1 * (k % 2)));
        }
      }
    }
    const lx = Math.max(1, L.lites[0] | 0),
      ly = Math.max(1, L.lites[1] | 0),
      mw = slim ? 0.022 : 0.035;
    // a shaped window is a fixed one: the frame fills the rectangle round the outline
    if (shape !== "rect") {
      fb(0, fw, y0, y1, -fd, fd, FC);
      fb(w - fw, w, y0, y1, -fd, fd, FC);
      if (shape !== "round") fb(fw, w - fw, y0, by, -fd, fd, FC);
      const N = 20;
      for (let k = 0; k < N; k++) {
        const ua = x0 + ((x1 - x0) * k) / N,
          ub = x0 + ((x1 - x0) * (k + 1)) / N,
          ta = topAt(ua),
          tb = topAt(ub),
          ba = botAt(ua),
          bb = botAt(ub);
        fb.poly([[ua, ta], [ub, tb], [ub, y1], [ua, y1]], -fd, fd, FC);
        if (shape === "round") fb.poly([[ua, y0], [ub, y0], [ub, bb], [ua, ba]], -fd, fd, FC);
        if (ta - ba > 1e-3 || tb - bb > 1e-3) fb.poly([[ua, ba], [ub, bb], [ub, tb], [ua, ta]], -0.003, 0.003, GLASS_C);
      }
      for (let k = 1; k < lx; k++) fb(x0 + ((x1 - x0) * k) / lx - mw, x0 + ((x1 - x0) * k) / lx + mw, by, ty, -0.055, 0.055, FC);
      for (let k = 1; k < ly; k++) fb(x0, x1, by + ((ty - by) * k) / ly - mw, by + ((ty - by) * k) / ly + mw, -0.055, 0.055, FC);
      for (let i = 0; i < lx; i++) for (let j = 0; j < ly; j++) grille(fb, x0 + ((x1 - x0) * i) / lx + (i ? mw : 0), x0 + ((x1 - x0) * (i + 1)) / lx - (i < lx - 1 ? mw : 0), by + ((ty - by) * j) / ly + (j ? mw : 0), by + ((ty - by) * (j + 1)) / ly - (j < ly - 1 ? mw : 0), 0, "all");
      return;
    }
    // the outer frame
    fb(0, fw, y0, y1, -fd, fd, FC);
    fb(w - fw, w, y0, y1, -fd, fd, FC);
    fb(fw, w - fw, y1 - fw, y1, -fd, fd, FC);
    fb(fw, w - fw, y0, by, -fd, fd, FC);
    // a fixed transom over opening sashes when the panes go two or more high
    let top = ty;
    if (t.op !== "fixed" && ly >= 2 && ty - by > 0.9) {
      top = ty - (ty - by) * 0.3;
      fb(x0, x1, top - mw, top + mw, -fd, fd, FC);
      for (let i = 0; i < lx; i++) {
        const a = x0 + ((x1 - x0) * i) / lx + (i ? mw : 0),
          b = x0 + ((x1 - x0) * (i + 1)) / lx - (i < lx - 1 ? mw : 0);
        i && fb(a - 2 * mw, a, top + mw, ty, -0.055, 0.055, FC);
        fb(a, b, top + mw, ty, -0.003, 0.003, GLASS_C);
        grille(fb, a, b, top + mw, ty, 0, "all");
      }
      top -= mw;
    }
    if (t.op === "fixed") {
      fb(x0, x1, by, ty, -0.003, 0.003, GLASS_C);
      for (let k = 1; k < lx; k++) fb(x0 + ((x1 - x0) * k) / lx - mw, x0 + ((x1 - x0) * k) / lx + mw, by, ty, -0.055, 0.055, FC);
      for (let k = 1; k < ly; k++) fb(x0, x1, by + ((ty - by) * k) / ly - mw, by + ((ty - by) * k) / ly + mw, -0.055, 0.055, FC);
      for (let i = 0; i < lx; i++) for (let j = 0; j < ly; j++) grille(fb, x0 + ((x1 - x0) * i) / lx + (i ? mw : 0), x0 + ((x1 - x0) * (i + 1)) / lx - (i < lx - 1 ? mw : 0), by + ((ty - by) * j) / ly + (j ? mw : 0), by + ((ty - by) * (j + 1)) / ly - (j < ly - 1 ? mw : 0), 0, "all");
      return;
    }
    // opening sashes: one unit per pane across (a slider's two panes are one unit), mullions between
    const units = t.op === "slide" ? 1 : lx,
      pn = t.op === "slide" ? Math.max(2, L.panels) : 1;
    for (let i = 0; i < units; i++) {
      const ua = x0 + ((x1 - x0) * i) / units + (i ? mw : 0),
        ub = x0 + ((x1 - x0) * (i + 1)) / units - (i < units - 1 ? mw : 0);
      i && fb(ua - 2 * mw, ua, by, top, -fd, fd, FC);
      if (t.op === "double_hung") {
        const mid = (by + top) / 2;
        sash(fb, ua, ub, mid - 0.02, top, -0.035, "top");
        sash(mover({ k: "rise", dy: (top - by) * 0.42 }), ua, ub, by, mid + 0.02, 0.035, "bottom");
        continue;
      }
      for (let p = 0; p < pn; p++) {
        const a = ua + ((ub - ua) * p) / pn + (p ? 0.01 : 0),
          b = ua + ((ub - ua) * (p + 1)) / pn - (p < pn - 1 ? 0.01 : 0),
          zOff = t.op === "slide" ? (p % 2 ? 0.035 : -0.035) : 0,
          right = units > 1 && i >= units / 2;
        let mv = null;
        if (t.op === "casement") mv = { k: "swing", pu: flip ? w - (right ? b : a) : right ? b : a, s: (right ? -1 : 1) * (flip ? -1 : 1), ang: 1.15, side: out };
        else if (t.op === "slide" && p === 1) mv = { k: "slide", du: -(b - a) * (flip ? -1 : 1) };
        else if (t.op === "awning") mv = { k: "tilt", py: top, e: -1, ang: 0.85, side: out };
        else if (t.op === "tilt_in") mv = { k: "tilt", py: by, e: 1, ang: 0.6, side: -out };
        sash(mv ? mover(mv) : fb, a, b, by, top, zOff, "all");
      }
    }
  }
  // ---- the door designer's doors (OP.designable): frame, sidelights, transom, and leaves with their faces. Cheap
  // geometry: rails and stiles at full thickness, recessed or raised panels as thinner boxes a shade darker, plank
  // and groove lines as thin dark strips, glass as GLASS_C boxes with muntins. Each leaf is one mover (one mesh).
  const METAL_C = {},
    metalC = (k) => METAL_C[k] || (METAL_C[k] = col((OP.DOOR_METALS[k] || OP.DOOR_METALS.brass).hex)),
    finishC = (k) => (OP.FINISHES[k] ? finishCol(k) : col(0x6f4d2c));
  // panel rows from the top: [height weight, panels across]
  const FACE_ROWS = { shaker: [[1, 1]], p2: [[0.58, 1], [0.42, 1]], p3: [[1, 3]], p5: [[1, 1], [1, 1], [1, 1], [1, 1], [1, 1]], p6: [[0.2, 2], [0.42, 2], [0.38, 2]] };
  function designedDoorGeo(gF, F, sp, flip, mode, out) {
    const { w, type: t, look: K, leaf } = sp,
      y0 = 0.02,
      y1 = y0 + sp.h,
      yD = y0 + leaf.h,
      fw = 0.05,
      thin = !!t.thin,
      T2 = thin ? 0.0175 : 0.0225,
      fin = finishC(sp.finish),
      lum = 0.3 * fin[0] + 0.59 * fin[1] + 0.11 * fin[2],
      frameC = lum < 0.12 || t.op === "pivot" ? shade(fin, 1.04) : FRAME_C,
      metal = metalC(K.metal),
      inSide = -out;
    const mu = (u) => (flip ? w - u : u);
    // a drawer in the unit's own frame (u along the wall from the left, y up, v across), flipped as the unit is
    const drawer = (g) => {
      const d = (a, b, ya, yb, va, vb, c) => g && b - a > 1e-4 && yb - ya > 1e-4 && lbox(g, F, flip ? w - b : a, flip ? w - a : b, ya, yb, va, vb, c);
      // a brace from (ua, ya) to (ub, yb), th wide, between va and vb across the wall
      d.diag = (ua, ya, ub, yb, th, va, vb, c) => g && lseg(g, F, mu(ua), ya, mu(ub), yb, th, va, vb, c);
      return d;
    };
    const fb = drawer(gF);
    const mover = (mv) => {
      let g = null;
      if (mode === "all") g = gF;
      else if (Array.isArray(mode)) (mode.push({ geo: (g = new Geo()), mv }), (g.glass = new Geo()));
      return drawer(g);
    };
    // glass with optional muntins: a pane across [a,b] x [ya,yb], bars cols x rows
    const pane = (d, a, b, ya, yb, cols, rows, barC) => {
      d(a, b, ya, yb, -0.006, 0.006, GLASS_C);
      for (let k = 1; k < cols; k++) d(a + ((b - a) * k) / cols - 0.011, a + ((b - a) * k) / cols + 0.011, ya, yb, -0.014, 0.014, barC);
      for (let k = 1; k < rows; k++) d(a, b, ya + ((yb - ya) * k) / rows - 0.011, ya + ((yb - ya) * k) / rows + 0.011, -0.014, 0.014, barC);
    };
    const bars = (a, b, ya, yb) => (K.bars ? [Math.max(1, Math.round((b - a) / 0.27)), Math.max(1, Math.round((yb - ya) / 0.3))] : [1, 1]);
    // ---- the frame: outer jambs and head, mullions beside sidelights, a transom bar, a threshold outside
    const la = leaf.a,
      lb = leaf.b,
      ySide = yD - fw;
    fb(0, fw, y0, y1, -0.07, 0.07, frameC);
    fb(w - fw, w, y0, y1, -0.07, 0.07, frameC);
    fb(fw, w - fw, y1 - fw, y1, -0.07, 0.07, frameC);
    if (la > 0) fb(la, la + fw, y0, ySide, -0.07, 0.07, frameC);
    if (lb < w - 1e-6) fb(lb - fw, lb, y0, ySide, -0.07, 0.07, frameC);
    if (K.transom) fb(fw, w - fw, yD - fw, yD, -0.07, 0.07, frameC);
    if (!thin) fb(fw, w - fw, y0 - 0.02, y0 + 0.006, -0.07, 0.07, [0.42, 0.38, 0.32]);
    // sidelights: a kick panel, then glass up to the head (horizontal bars when the door has bars)
    const sideLite = (s0, s1) => {
      const kick = Math.min(0.6, Math.max(0.24, K.glass === "half" || K.glass === "three" ? 0.24 : 0.3));
      fb(s0, s1, y0, y0 + kick, -T2, T2, fin);
      fb(s0 + 0.04, s1 - 0.04, y0 + 0.07, y0 + kick - 0.05, -T2 - 0.004, T2 + 0.004, shade(fin, 0.9));
      fb(s0, s0 + 0.035, y0 + kick, ySide, -T2, T2, fin);
      fb(s1 - 0.035, s1, y0 + kick, ySide, -T2, T2, fin);
      fb(s0 + 0.035, s1 - 0.035, ySide - 0.035, ySide, -T2, T2, fin);
      pane(fb, s0 + 0.035, s1 - 0.035, y0 + kick, ySide - 0.035, 1, K.bars ? Math.max(1, Math.round((ySide - y0 - kick) / 0.32)) : 1, fin);
    };
    if (la > 0) sideLite(fw, la);
    if (lb < w - 1e-6) sideLite(lb, w - fw);
    if (K.transom) {
      const ta = fw,
        tb = w - fw,
        tya = yD,
        tyb = y1 - fw;
      fb(ta, tb, tya, tya + 0.035, -T2, T2, fin);
      fb(ta, tb, tyb - 0.035, tyb, -T2, T2, fin);
      // mullions in line with the sidelights below, then bars across the door's width
      const cuts = [ta];
      if (la > 0) cuts.push(la + fw / 2);
      if (lb < w - 1e-6) cuts.push(lb - fw / 2);
      cuts.push(tb);
      for (let k = 1; k < cuts.length - 1; k++) fb(cuts[k] - 0.02, cuts[k] + 0.02, tya + 0.035, tyb - 0.035, -T2, T2, fin);
      for (let k = 0; k + 1 < cuts.length; k++) {
        const a = cuts[k] + (k ? 0.02 : 0),
          b = cuts[k + 1] - (k + 2 < cuts.length ? 0.02 : 0);
        pane(fb, a, b, tya + 0.035, tyb - 0.035, K.bars ? Math.max(1, Math.round((b - a) / 0.3)) : 1, 1, fin);
      }
    }
    // ---- the leaves
    const x0 = la + fw,
      x1 = lb - fw,
      ly0 = y0 + 0.004,
      ly1 = ySide - 0.003,
      pair = (t.look.panels || 1) === 2 && t.op === "swing",
      pivot = t.op === "pivot";
    const leaves = pair
      ? [
          [x0 + 0.003, (x0 + x1) / 2 - 0.002, x0, 1],
          [(x0 + x1) / 2 + 0.002, x1 - 0.003, x1, -1],
        ]
      : [[x0 + 0.003, x1 - 0.003, pivot ? x0 + Math.min(0.26, (x1 - x0) * 0.2) : x0, 1]];
    for (let n = 0; n < leaves.length; n++) {
      const [a, b, hinge, s] = leaves[n],
        mv = { k: "swing", pu: mu(hinge), s: s * (flip ? -1 : 1), ang: pivot ? 1.45 : 1.5, side: -out };
      if (t.op === "dutch") {
        // the bottom and top halves: two meshes on the same hinge
        const cut = y0 + 1.07,
          lo = mover(mv),
          hi = mover({ ...mv });
        const half = FACE_ROWS[K.face] && K.face !== "p3" ? "shaker" : K.face;
        leafFace(lo, a, b, ly0, cut - 0.003, { ...K, face: half, glass: "none" }, fin, T2, inSide, false);
        leafFace(hi, a, b, cut + 0.003, ly1, { ...K, face: half, glass: K.glass === "none" ? "none" : K.glass === "slot" ? "slot" : "full" }, fin, T2, inSide, true);
        hardware(lo, a, b, ly0, false, K, metal, T2, thin);
        lo(a + 0.02, b - 0.02, cut - 0.03, cut - 0.003, -T2 - 0.035, T2 + 0.035, shade(fin, 1.02));
        continue;
      }
      const d = mover(mv);
      leafFace(d, a, b, ly0, ly1, K, fin, T2, inSide, false);
      hardware(d, a, b, ly0, n === 1, K, metal, T2, thin, ly1);
    }
  }
  // one leaf's face: rails, stiles, panels, glass, grooves or planks. d is the leaf's drawer; latch side is b.
  function leafFace(d, a, b, ya, yb, K, fin, T2, inSide, upper) {
    const W = b - a,
      plank = K.face === "plank",
      slab = K.face === "flush" || K.face === "groove" || plank,
      steel = K.face === "flush" && K.glass === "full",
      st = steel ? 0.055 : Math.min(0.115, W * 0.16),
      topR = steel ? 0.055 : Math.min(0.115, (yb - ya) * 0.12),
      botR = upper ? topR : steel ? 0.11 : slab ? st : Math.min(0.2, (yb - ya) * 0.12),
      yi0 = ya + botR,
      yi1 = yb - topR,
      H = yi1 - yi0,
      dark = shade(fin, 0.62),
      rows = []; // { y0, y1, cells: [{ u0, u1, k }] }, top to bottom; cells k: glass, panel, raised, solid
    const ua = a + st,
      ub = b - st;
    // the glass first, from the top
    let g0 = yi1;
    if (K.glass === "slot") {
      const sw = Math.min(0.14, W * 0.16),
        s1 = ub - Math.min(0.12, W * 0.12),
        s0 = s1 - sw;
      rows.push({ y0: yi0 + H * 0.05, y1: yi1 - H * 0.05, cells: [{ u0: s0, u1: s1, k: "glass" }] });
      g0 = yi0;
    } else if (K.glass !== "none") {
      const frac = K.glass === "top" ? Math.min(0.42, H * 0.24) / H : K.glass === "half" ? 0.48 : K.glass === "three" ? 0.72 : K.glass === "craft" ? 0.27 : 1;
      g0 = yi1 - H * frac;
      const cells = [];
      if (K.glass === "craft") {
        const n = W > 0.95 ? 4 : 3,
          m = 0.035;
        for (let k = 0; k < n; k++) cells.push({ u0: ua + ((ub - ua + m) * k) / n, u1: ua + ((ub - ua + m) * (k + 1)) / n - m, k: "glass", bars: false });
      } else if (plank) cells.push({ u0: ua + 0.03, u1: ub - 0.03, k: "glass" });
      else cells.push({ u0: ua, u1: ub, k: "glass" });
      rows.push({ y0: g0, y1: yi1, cells });
      if (K.glass === "craft") rows.shelf = g0;
    }
    // then the panels below the glass, in the bottom rows of the layout that still fit
    const rest0 = yi0,
      rest1 = K.glass === "slot" ? yi0 : K.glass === "none" ? yi1 : g0 - 0.1;
    if (!slab && rest1 - rest0 > 0.12) {
      let R = FACE_ROWS[K.face] || FACE_ROWS.shaker;
      const keep = K.glass === "none" ? R.length : Math.max(1, Math.round((R.length * (rest1 - rest0)) / H));
      R = R.slice(R.length - keep);
      const rail = 0.1,
        tot = R.reduce((q, r) => q + r[0], 0),
        span = rest1 - rest0 - rail * (R.length - 1);
      let y = rest1;
      for (const [wt, nc] of R) {
        const hh = (span * wt) / tot,
          cells = [],
          mul = 0.1,
          cw = (ub - ua - mul * (nc - 1)) / nc;
        for (let k = 0; k < nc; k++) cells.push({ u0: ua + k * (cw + mul), u1: ua + k * (cw + mul) + cw, k: K.face === "p6" ? "raised" : "panel" });
        rows.push({ y0: y - hh, y1: y, cells });
        y -= hh + rail;
      }
    }
    // ---- planks: boards across the whole leaf, cut round the glass, with a ledge-and-brace on the inside face
    if (plank) {
      const n = Math.max(3, Math.round(W / 0.14)),
        bw = W / n,
        gl = rows.filter((r) => r.cells.some((c) => c.k === "glass"));
      for (let k = 0; k < n; k++) {
        const u0 = a + k * bw,
          u1 = u0 + bw,
          c = shade(fin, 0.92 + 0.14 * hash(k, 7, Math.round(W * 100))),
          ys = [[ya, yb]];
        for (const r of gl)
          for (const cl of r.cells)
            if (cl.u1 > u0 + 1e-4 && cl.u0 < u1 - 1e-4) {
              const nx = [];
              for (const [p, q] of ys) (p < r.y0 && nx.push([p, Math.min(q, r.y0)]), q > r.y1 && nx.push([Math.max(p, r.y1), q]));
              ys.splice(0, ys.length, ...nx);
            }
        for (const [p, q] of ys) {
          // a board, cut to the glass where it crosses it
          d(u0 + 0.003, u1 - 0.003, p, q, -T2, T2, c);
          k && d(u0 - 0.004, u0 + 0.004, p, q, -T2 + 0.006, T2 - 0.006, dark);
        }
        // the boards beside the glass fill the gap between the glass cell and the board edge
        for (const r of gl)
          for (const cl of r.cells) {
            if (cl.u0 > u0 && cl.u0 < u1) d(u0 + 0.003, cl.u0, r.y0, r.y1, -T2, T2, c);
            if (cl.u1 > u0 && cl.u1 < u1) d(cl.u1, u1 - 0.003, r.y0, r.y1, -T2, T2, c);
          }
      }
      for (const r of gl) for (const cl of r.cells) glassCell(d, cl, r, K, fin, T2);
      // the ledges and the brace, on the inside face
      const v0 = inSide > 0 ? T2 : -T2 - 0.022,
        v1 = inSide > 0 ? T2 + 0.022 : -T2,
        bc = shade(fin, 0.95),
        top = gl.length ? Math.min(...gl.map((r) => r.y0)) - 0.08 : yb - 0.2,
        lo = ya + 0.14,
        mid = (lo + top) / 2;
      for (const yy of gl.length ? [lo, top] : [lo, mid, top]) d(a + 0.04, b - 0.04, yy - 0.06, yy + 0.06, v0, v1, bc);
      d.diag(a + 0.1, lo + 0.06, b - 0.1, (gl.length ? top : mid) - 0.06, 0.1, v0 + 0.002, v1 - 0.002, bc);
      gl.length || d.diag(a + 0.1, mid + 0.06, b - 0.1, top - 0.06, 0.1, v0 + 0.002, v1 - 0.002, bc);
      return;
    }
    // ---- rails and stiles at full thickness: everything the cells leave
    d(a, ua, ya, yb, -T2, T2, fin);
    d(ub, b, ya, yb, -T2, T2, fin);
    const sorted = rows.slice().sort((p, q) => q.y1 - p.y1);
    let y = yb;
    for (const r of sorted) {
      d(ua, ub, r.y1, y, -T2, T2, fin);
      let u = ua;
      for (const cl of r.cells.slice().sort((p, q) => p.u0 - q.u0)) {
        d(u, cl.u0, r.y0, r.y1, -T2, T2, fin);
        u = cl.u1;
      }
      d(u, ub, r.y0, r.y1, -T2, T2, fin);
      y = r.y0;
    }
    d(ua, ub, ya, y, -T2, T2, fin);
    // the cells
    for (const r of rows)
      for (const cl of r.cells) {
        if (cl.k === "glass") glassCell(d, cl, r, K, fin, T2);
        else if (cl.k === "panel") d(cl.u0, cl.u1, r.y0, r.y1, -T2 + 0.009, T2 - 0.009, shade(fin, 0.9));
        else if (cl.k === "raised") {
          d(cl.u0, cl.u1, r.y0, r.y1, -T2 + 0.012, T2 - 0.012, shade(fin, 0.86));
          const m = Math.min(0.045, (cl.u1 - cl.u0) * 0.2);
          d(cl.u0 + m, cl.u1 - m, r.y0 + m, r.y1 - m, -T2 + 0.004, T2 - 0.004, shade(fin, 0.98));
        }
      }
    // the craftsman shelf under the lites
    if (rows.shelf !== undefined) d(ua - 0.015, ub + 0.015, rows.shelf - 0.05, rows.shelf - 0.022, -T2 - 0.018, T2 + 0.018, shade(fin, 1.04));
    // grooves: thin dark lines across the slab, broken where glass is
    if (K.face === "groove") {
      const gl = rows.flatMap((r) => r.cells.filter((c) => c.k === "glass").map((c) => ({ ...c, y0: r.y0, y1: r.y1 }))),
        n = Math.max(3, Math.round((yb - ya) / 0.3));
      for (let k = 1; k < n; k++) {
        const gy = ya + ((yb - ya) * k) / n;
        let u = a;
        for (const c of gl.filter((c) => gy > c.y0 - 0.02 && gy < c.y1 + 0.02).sort((p, q) => p.u0 - q.u0)) {
          d(u, c.u0 - 0.02, gy - 0.004, gy + 0.004, -T2 - 0.0015, T2 + 0.0015, shade(fin, 0.55));
          u = c.u1 + 0.02;
        }
        d(u, b, gy - 0.004, gy + 0.004, -T2 - 0.0015, T2 + 0.0015, shade(fin, 0.55));
      }
    }
  }
  function glassCell(d, cl, r, K, fin, T2) {
    // a small bead round the glass, then the pane and its bars
    const bc = shade(fin, 0.94),
      [cx, cy] = cl.bars === false || !K.bars ? [1, 1] : [Math.max(1, Math.round((cl.u1 - cl.u0) / 0.27)), Math.max(1, Math.round((r.y1 - r.y0) / 0.3))];
    d(cl.u0, cl.u1, r.y0, r.y0 + 0.012, -T2 + 0.006, T2 - 0.006, bc);
    d(cl.u0, cl.u1, r.y1 - 0.012, r.y1, -T2 + 0.006, T2 - 0.006, bc);
    d(cl.u0, cl.u0 + 0.012, r.y0, r.y1, -T2 + 0.006, T2 - 0.006, bc);
    d(cl.u1 - 0.012, cl.u1, r.y0, r.y1, -T2 + 0.006, T2 - 0.006, bc);
    const a = cl.u0 + 0.012,
      b = cl.u1 - 0.012,
      ya = r.y0 + 0.012,
      yb = r.y1 - 0.012;
    d(a, b, ya, yb, -0.006, 0.006, GLASS_C);
    for (let k = 1; k < cx; k++) d(a + ((b - a) * k) / cx - 0.011, a + ((b - a) * k) / cx + 0.011, ya, yb, -0.014, 0.014, fin);
    for (let k = 1; k < cy; k++) d(a, b, ya + ((yb - ya) * k) / cy - 0.011, ya + ((yb - ya) * k) / cy + 0.011, -0.014, 0.014, fin);
  }
  // the handle on both faces, near the latch edge (b, or a for the second leaf of a pair)
  function hardware(d, a, b, ya, left, K, mc, T2, thin, yb) {
    const u = left ? a + 0.065 : b - 0.065,
      sg = left ? 1 : -1,
      hy = ya + 0.95;
    for (const s of [-1, 1]) {
      const v0 = s > 0 ? T2 : -T2,
        V = (p, q) => (s > 0 ? [v0 + p, v0 + q] : [v0 - q, v0 - p]);
      if (K.hw === "pull") {
        const L = Math.min(1.0, ((yb || ya + 2) - ya) * 0.45),
          p0 = hy - 0.3,
          p1 = p0 + L;
        d(u - 0.014, u + 0.014, p0, p1, ...V(0.05, 0.075), mc);
        d(u - 0.008, u + 0.008, p0 + 0.05, p0 + 0.08, ...V(0, 0.05), mc);
        d(u - 0.008, u + 0.008, p1 - 0.08, p1 - 0.05, ...V(0, 0.05), mc);
        continue;
      }
      d(u - 0.03, u + 0.03, hy - 0.03, hy + 0.03, ...V(0, 0.008), mc);
      if (K.hw === "lever") {
        d(u - 0.01, u + 0.01, hy - 0.01, hy + 0.01, ...V(0.008, 0.055), mc);
        d(sg > 0 ? u - 0.01 : u - 0.12, sg > 0 ? u + 0.12 : u + 0.01, hy - 0.011, hy + 0.011, ...V(0.045, 0.067), mc);
      } else {
        d(u - 0.009, u + 0.009, hy - 0.009, hy + 0.009, ...V(0.008, 0.035), mc);
        d(u - 0.027, u + 0.027, hy - 0.027, hy + 0.027, ...V(0.035, 0.068), mc);
      }
      // a deadbolt over the latch on an outside door
      thin || d(u - 0.024, u + 0.024, hy + 0.13, hy + 0.178, ...V(0, 0.014), mc);
    }
  }
  // ---- the moving parts of built free doors and windows: one mesh each, a cheap matrix tween, nothing when idle
  const leafBusy = new Set(),
    _lm = new T.Matrix4();
  const openOf = (id) => {
    const c = G.sim && G.sim.state.sys.construction;
    return !!(c && c.open && c.open[id]);
  };
  function drawLeaves(S, st) {
    for (const L of S.leaves || []) {
      S.group.remove(L.mesh);
      L.mesh.geometry.dispose();
      if (L.glass) (S.group.remove(L.glass), L.glass.geometry.dispose());
      leafBusy.delete(L);
    }
    S.leaves = [];
    for (const o of S.fopen) {
      if (!st.all && S.plan.has(o.f.id)) continue;
      const parts = [];
      unitGeo(null, fF(o.f), o.sp, !!o.f.flip, parts, o.f.out || 1);
      for (const p of parts) {
        const mesh = new T.Mesh(p.geo.build(), S.wallMat);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        S.group.add(mesh);
        const L = { id: o.f.id, S, mesh, mv: p.mv, o, cur: openOf(o.f.id) ? 1 : 0, glass: null };
        if (p.geo.glass && p.geo.glass.p.length) {
          L.glass = new T.Mesh(p.geo.glass.build(), S.glassMat);
          L.glass.matrixAutoUpdate = false;
          L.glass.frustumCulled = false;
          L.glass.renderOrder = 2;
          S.group.add(L.glass);
        }
        setLeaf(L, L.cur);
        S.leaves.push(L);
      }
    }
  }
  // the leaf's matrix at openness t (0 closed, 1 open): slide, rise, roll, or a turn about a hinge line
  function setLeaf(L, t) {
    const f = L.o.f,
      mv = L.mv,
      { U, V, O: P0 } = frameOf(fF(f)),
      e = t * t * (3 - 2 * t);
    if (mv.k === "slide") _lm.makeTranslation(U[0] * mv.du * e, 0, U[2] * mv.du * e);
    else if (mv.k === "rise") _lm.makeTranslation(0, mv.dy * e, 0);
    else if (mv.k === "roll") {
      const k = 1 - 0.94 * e;
      _lm.set(1, 0, 0, 0, 0, k, 0, mv.top * (1 - k), 0, 0, 1, 0, 0, 0, 0, 1);
    } else {
      const sw = mv.k === "swing",
        e1 = sw ? [U[0] * mv.s, 0, U[2] * mv.s] : [0, mv.e, 0],
        e2 = [V[0] * mv.side, 0, V[2] * mv.side],
        P = sw ? [P0[0] + U[0] * mv.pu, 0, P0[2] + U[2] * mv.pu] : [P0[0] + U[0] * L.o.sp.w * 0.5, mv.py, P0[2] + U[2] * L.o.sp.w * 0.5],
        ph = mv.ang * e,
        c = Math.cos(ph),
        sn = Math.sin(ph),
        R = (i, j) => (i === j ? 1 : 0) + (c - 1) * (e1[i] * e1[j] + e2[i] * e2[j]) + sn * (e2[i] * e1[j] - e1[i] * e2[j]);
      _lm.set(R(0, 0), R(0, 1), R(0, 2), P[0] - (R(0, 0) * P[0] + R(0, 1) * P[1] + R(0, 2) * P[2]), R(1, 0), R(1, 1), R(1, 2), P[1] - (R(1, 0) * P[0] + R(1, 1) * P[1] + R(1, 2) * P[2]), R(2, 0), R(2, 1), R(2, 2), P[2] - (R(2, 0) * P[0] + R(2, 1) * P[1] + R(2, 2) * P[2]), 0, 0, 0, 1);
    }
    L.mesh.matrix.copy(_lm);
    L.mesh.matrixWorldNeedsUpdate = true;
    if (L.glass) (L.glass.matrix.copy(_lm), (L.glass.matrixWorldNeedsUpdate = true));
  }
  function leafTick(dt) {
    for (const L of leafBusy) {
      const want = openOf(L.id) ? 1 : 0;
      L.cur += Math.sign(want - L.cur) * Math.min(Math.abs(want - L.cur), dt * 2.2);
      setLeaf(L, L.cur);
      if (L.cur === want) leafBusy.delete(L);
    }
  }
  // every built unit that moves, for the hands: where it is and what it does
  function openUnits() {
    const out = [];
    for (const S of B.structs) {
      const seen = new Set();
      for (const L of S.leaves || []) {
        if (seen.has(L.id)) continue;
        seen.add(L.id);
        const sp = L.o.sp,
          f = L.o.f,
          c = P3(fF(f), sp.w / 2, 0, 0),
          [x, z] = toWorld(S, c[0], c[2]);
        out.push({ id: f.id, x, z, y: S.y0 + (sp.type.kind === "door" ? 1.0 : sp.sill + sp.h / 2), r: Math.max(sp.w, sp.h) / 2, name: sp.type.name.toLowerCase(), kind: sp.type.kind, op: sp.type.op, open: openOf(f.id) });
      }
    }
    return out;
  }
  function operateUnit(id, open) {
    if (!G.sim) return null;
    const r = G.sim.commandNow("construction.operate", open === undefined ? { id } : { id, open });
    for (const S of B.structs) for (const L of S.leaves || []) L.id === id && leafBusy.add(L);
    return r;
  }
  // which side of a free opening's wall is outdoors: +1 for the +v side (+z along x, +x along z), else -1
  function freeOut(S, f, w) {
    const { V } = frameOf(fF(f)),
      c = P3(fF(f), w / 2, 0, 0),
      l = onFloorAt(S, c[0] + V[0] * 0.4, c[2] + V[2] * 0.4),
      r = onFloorAt(S, c[0] - V[0] * 0.4, c[2] - V[2] * 0.4);
    return l && !r ? -1 : 1;
  }
  // for an angled wall piece: which free openings cut it, as fractions of its length and real heights
  function segCuts(D, sg) {
    const out = [];
    if (!D.free || !D.free.length) return out;
    const dx = sg[2] - sg[0],
      dz = sg[3] - sg[1],
      len = Math.hypot(dx, dz) || 1,
      ux = dx / len,
      uz = dz / len;
    for (const f of D.free) {
      if (f.d !== "f" || Math.abs(Math.abs(f.ux * ux + f.uz * uz) - 1) > 1e-3) continue;
      const ex = f.gx - sg[0],
        ez = f.gz - sg[1];
      if (Math.abs(ex * uz - ez * ux) > 0.02) continue;
      const sp = OP.freeSpec(f);
      if (!sp) continue;
      const p0 = (f.gx + f.ux * (f.pos - OP.ROUGH_GAP) - sg[0]) * ux + (f.gz + f.uz * (f.pos - OP.ROUGH_GAP) - sg[1]) * uz,
        p1 = (f.gx + f.ux * (f.pos + sp.w + OP.ROUGH_GAP) - sg[0]) * ux + (f.gz + f.uz * (f.pos + sp.w + OP.ROUGH_GAP) - sg[1]) * uz,
        a = Math.min(p0, p1) / len,
        b = Math.max(p0, p1) / len;
      if (b <= 0 || a >= 1) continue;
      out.push({ t0: Math.max(0, a), t1: Math.min(1, b), y0: sp.rough.sill, y1: sp.rough.sill + sp.rough.height });
    }
    return out;
  }
  // for a wall module: which free openings cut it (module-local t, real heights)
  function freeCuts(D, i, j, d) {
    const out = [];
    if (!D.free || !D.free.length) return out;
    const line = d === 0 ? j : i,
      t0 = d === 0 ? i : j;
    for (const f of D.free) {
      if (f.d !== d || f.line !== line) continue;
      const sp = OP.freeSpec(f);
      if (!sp) continue;
      const a = f.pos - OP.ROUGH_GAP - t0,
        b = f.pos + sp.w + OP.ROUGH_GAP - t0;
      if (b <= 0 || a >= 1) continue;
      out.push({ t0: Math.max(0, a), t1: Math.min(1, b), y0: sp.rough.sill, y1: sp.rough.sill + sp.rough.height });
    }
    return out;
  }
  // a plain wall module with holes in it
  function holedWall(g, i, j, d, depth, cuts, PL) {
    const hs = (k) => 0.9 + 0.2 * hash(i * 7 + k, j * 13 + d, 5),
      xs = [0, 1];
    for (const c of cuts) xs.push(c.t0, c.t1);
    xs.sort((p, q) => p - q);
    const planks = (ta, tb, ya, yb, k) => {
      const rows = Math.max(1, Math.round((yb - ya) / 0.34)),
        hh = (yb - ya) / rows;
      for (let r = 0; r < rows; r++) ebox(g, i, j, d, ta, tb, ya + r * hh, ya + (r + 1) * hh, 0.07 - (r % 2) * 0.004, shade(PL.plank, hs(k + r)));
    };
    for (let n = 0; n + 1 < xs.length; n++) {
      const ta = xs[n],
        tb = xs[n + 1];
      if (tb - ta < 1e-4) continue;
      const mid = (ta + tb) / 2,
        c = cuts.find((q) => mid > q.t0 && mid < q.t1);
      if (!c) {
        ebox(g, i, j, d, ta, tb, -depth, 0.3, EK < 1 ? 0.075 : 0.13, shade(PL.stone, 0.92 + 0.16 * hash(i, j, d + 9)));
        planks(ta, tb, 0.3, WALL_H, n);
        continue;
      }
      if (c.y0 < 0.3) ebox(g, i, j, d, ta, tb, -depth, Math.max(0.02, c.y0), EK < 1 ? 0.075 : 0.13, shade(PL.stone, 0.92));
      else {
        ebox(g, i, j, d, ta, tb, -depth, 0.3, EK < 1 ? 0.075 : 0.13, shade(PL.stone, 0.92 + 0.16 * hash(i, j, d + 9)));
        c.y0 > 0.31 && planks(ta, tb, 0.3, c.y0, n);
      }
      WALL_H - c.y1 > 0.01 && planks(ta, tb, c.y1, WALL_H, n + 5);
    }
    ebox(g, i, j, d, 0, 1, WALL_H, EAVE, 0.095, PL.beam);
  }

  // D = { floors:Set, walls:Map, roofs:[], segs:[], rings:[] }. Returns { main:Geo, roof:Geo }.
  function buildGeo(D, depth) {
    const g = new Geo(),
      rg = new Geo();
    g.glass = new Geo();
    const hs = D.hs || 1;
    // floors raised well clear of the ground stand on posts instead of a solid plinth
    // a building on a real foundation has no stone skirt: its floor frame shows, and the piers stand under it
    const raised = !!D.found && D.found !== "plinth" && !D.level,
      open = !raised && D.lift > 0 && depth > 1.6,
      full = depth;
    if (open) depth = 0.2;
    if (raised) depth = D.found === "slab" ? 0.06 : 0.085;
    for (const k of D.floors) {
      const [i, j] = parse(k);
      if (D.id && wellOver(D, i, j)) continue;
      const fm = FLOORS[(D.fmat && D.fmat.get(k)) || "planks"],
        fcol = fm.c2 && (i + j) & 1 ? fm.c2 : fm.c;
      for (let p = 0; p < 2; p++) g.abox(i, 0, j + p * 0.5, i + 1, FLOOR_T - (p ? 0.006 : 0), j + p * 0.5 + 0.5, shade(fcol, 0.9 + 0.2 * hash(i, j, p)));
      const st = raised ? (D.found === "slab" ? CONCRETE : shade(C.beam, 1.2)) : open ? C.beam : shade(C.stone, 0.85);
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
      tall = new Set(),
      vmat = new Map();
    for (const [k, type] of D.walls) {
      const [i, j, d] = parse(k);
      if (D.hid && D.hid.has(k)) continue;
      const wm = (D.wmat && D.wmat.get(k)) || "timber";
      PAL = raised ? woodFoot(wm) : WALLS[wm];
      const cuts = type === "wall" ? freeCuts(D, i, j, d) : [];
      EK = type === "wall" && stickWall("wall", wm) ? 0.5 : 1;   // a framed wall: the old body stays in behind the stud faces, so studs and batts show while it is open
      if (EK < 1) PAL = OSB_PAL;           // and what shows between the studs is the back of the sheathing
      if (cuts.length) holedWall(g, i, j, d, depth, cuts, PAL);
      else wallPieces(isLow(type) ? late : g, i, j, d, type, depth);
      EK = 1;
      for (const vk of [ck(i, j), d === 0 ? ck(i + 1, j) : ck(i, j + 1)]) vmat.has(vk) || vmat.set(vk, wm);
      touch(i, j, d);
      if (d === 0) touch(i + 1, j, d);
      else touch(i, j + 1, d);
      if (!isLow(type)) (tall.add(ck(i, j)), tall.add(d === 0 ? ck(i + 1, j) : ck(i, j + 1)));
    }
    // the units of free openings that stand
    for (const f of D.free || []) {
      const sp = f.built === false ? null : OP.freeSpec(f);
      sp && unitGeo(g, fF(f), sp, !!f.flip, f.ghost ? "all" : "static", f.out || 1);
    }
    for (const [k, ds] of verts) {
      const [i, j] = parse(k);
      const vp = WALLS[vmat.get(k) || "timber"],
        pb = vp.beam;
      if (!tall.has(k)) late.abox(i - 0.08, -depth, j - 0.08, i + 0.08, 1.1, j + 0.08, pb);
      else if (!(ds.length === 2 && ds[0] === ds[1])) { const h = stickWall("wall", vmat.get(k) || "timber") ? 0.042 : 0.12; g.abox(i - h, -depth, j - h, i + h, EAVE + 0.03, j + h, pb); }   // a sided corner hides its post inside the trim
    }
    rg.yo = (hs - 1) * EAVE;
    // a framed building's gables are its sheathing and siding (drawn as members): the roof's own gable infill stays in behind them
    EK = [...vmat.values()].some((m) => stickWall("wall", m)) ? 0.5 : 1;
    for (const r of D.roofs) {
      RPAL = roofCol(r);
      roofPieces(rg, r, full);
    }
    EK = 1;
    const ends = new Set();
    (D.segs || []).forEach((sg, n) => {
      const low = isLow(sg[4]);
      if (D.id && inRings(D, (sg[0] + sg[2]) / 2, (sg[1] + sg[3]) / 2)) return;
      PAL = raised ? woodFoot(sg[5] || "timber") : WALLS[sg[5] || "timber"];
      const cuts = sg[4] === "wall" ? segCuts(D, sg) : null, clad = sg[4] === "wall" && stickWall("wall", sg[5] || "timber");
      EK = clad ? 0.5 : 1;
      if (EK < 1) PAL = OSB_PAL;
      if (cuts && cuts.length) {
        // a plain angled wall with doors or windows in it: the same wall with their rough openings cut out
        const dx = sg[2] - sg[0],
          dz = sg[3] - sg[1],
          len = Math.hypot(dx, dz) || 1;
        g.xf = { ox: sg[0], oz: sg[1], c: dx / len, s: -dz / len, su: len, oy: 0 };
        holedWall(g, 0, 0, 0, depth, cuts, PAL);
        g.xf = null;
      } else freePiece(low ? late : g, sg[0], sg[1], sg[2], sg[3], sg[4], depth, n);
      EK = 1;
      for (const [x, z] of [
        [sg[0], sg[1]],
        [sg[2], sg[3]],
      ]) {
        const k = Math.round(x * 20) + "," + Math.round(z * 20) + (low ? "r" : "");
        if (ends.has(k)) continue;
        ends.add(k);
        if (low) late.abox(x - 0.08, -depth, z - 0.08, x + 0.08, 1.1, z + 0.08, PAL.beam);
        else if (clad) g.abox(x - 0.042, -depth, z - 0.042, x + 0.042, EAVE + 0.03, z + 0.042, PAL.beam);    // inside the siding's corner trim
        else g.abox(x - 0.12, -depth, z - 0.12, x + 0.12, EAVE + 0.03, z + 0.12, PAL.beam);
      }
    });
    for (const r of D.rings || []) {
      rg.yo = r.h * EAVE * (hs - 1);
      PAL = WALLS[r.mat || "timber"];
      RPAL = (ROOFS[r.rmat || "thatch"] || ROOFS.thatch).c;
      ringPieces(g, rg, r, full);
    }
    rg.yo = (hs - 1) * EAVE;
    for (const p of D.polys || []) {
      RPAL = (ROOFS[p.rmat || "thatch"] || ROOFS.thatch).c;
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
    if (hs !== 1) for (const q of [g.p, g.glass.p]) for (let n = 1; n < q.length; n += 3) q[n] = stretchY(q[n], hs);
    for (const st of D.stairs || []) stairPieces(g, st, hs);
    const fr = D.ox !== undefined ? D : D.frame;
    if (fr) (D.paths || []).forEach((p, n) => pathPieces(late, fr, p, n));
    const glow = new Geo();
    for (const it of D.decor || []) decorPieces(late, glow, it, decorY(D, it), EAVE * hs);
    append(g.p, late.p);
    append(g.n, late.n);
    append(g.c, late.c);
    return { main: g, roof: rg, glow, glass: g.glass };
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
  fadeB(wallMat);
  texel(wallMat);
  G.renderer.localClippingEnabled = true;
  // warm light that comes on when you are home
  const hearth = new T.PointLight(0xffb469, 0, 11, 1.6);
  G.scene.add(hearth);
  function makeWallMat(plane, near, sideA, sideB) {
    // a wall is cut only where it is both above waist height and between the camera and you
    const m = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide, clippingPlanes: [plane, near, sideA, sideB], clipIntersection: true, clipShadows: true });
    fadeB(m);
    return texel(m);
  }
  // ---- glass: one transparent mesh per structure, no extra render pass. It reflects the sky and the ground by the
  // Fresnel law (faint head-on, nearly a mirror at a glancing angle), catches the sun as a hard glint, tints what is seen
  // through it a little green, and casts no shadow, so sunlight falls through the windows onto the floor.
  const GLASS_U = G.skyU || { uGSunDir: { value: new T.Vector3(0.4, 0.8, 0.3) }, uGSunCol: { value: new T.Color(1, 0.95, 0.85) }, uGSky: { value: new T.Color(0xa9c4d6) }, uGZen: { value: new T.Color(0x5b86b5) } };
  GLASS_U.uGlassA = { value: 0.2 };
  function makeGlassMat(planes) {
    const m = new T.MeshLambertMaterial({ color: 0x1e2c2e, transparent: true, depthWrite: false, side: T.FrontSide, clippingPlanes: planes || null, clipIntersection: true });
    fadeB(m);
    const before = m.onBeforeCompile,
      key = m.customProgramCacheKey;
    m.onBeforeCompile = (sh, r) => {
      before && before.call(m, sh, r);
      for (const k in GLASS_U) sh.uniforms[k] = GLASS_U[k];
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 uGSunDir, uGSunCol, uGSky, uGZen; uniform float uGlassA;").replace(
        "#include <opaque_fragment>",
        `{
          float cosT = clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0);
          float fr = 0.07 + 0.93 * pow(1.0 - cosT, 5.0);
          vec3 Rw = normalize((vec4(reflect(-geometryViewDir, geometryNormal), 0.0) * viewMatrix).xyz);
          float up = Rw.y;
          vec3 skyC = mix(uGSky, uGZen, pow(clamp(up, 0.0, 1.0), 0.6));
          vec3 env = mix(uGSky * vec3(0.27, 0.29, 0.23), skyC, smoothstep(-0.05, 0.03, up));
          env *= 1.0 - 0.4 * exp(-pow((up - 0.05) / 0.07, 2.0));   // the dark line of far trees on the horizon
          float sd = max(dot(Rw, normalize(uGSunDir)), 0.0);
          vec3 refl = env + uGSunCol * (pow(sd, 900.0) * 14.0 + pow(sd, 48.0) * 0.35);
          float a = clamp(uGlassA + (1.0 - uGlassA) * fr, 0.0, 1.0);
          outgoingLight = (outgoingLight * uGlassA + refl * fr) / max(a, 1e-3);
          diffuseColor.a = a;
        }
        #include <opaque_fragment>`,
      );
    };
    m.customProgramCacheKey = () => (key ? key.call(m) : "") + "|glass";
    return m;
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
  function makeRoofMat() {
    const m = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide, alphaHash: true });
    fadeB(m);
    return texel(m);
  }
  const ghostOpts = { transparent: true, opacity: 0.5, depthTest: false, depthWrite: false, fog: false, side: T.DoubleSide };
  const ghostAdd = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ color: 0xffe2a0, ...ghostOpts }));
  const ghostDel = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ color: 0xe0563f, ...ghostOpts, opacity: 0.6 }));
  // a ghost that cannot be placed is hatched as well as red, so it reads without relying on colour
  ghostAdd.material.userData.hatch = { value: 0 };
  ghostAdd.material.onBeforeCompile = (sh) => {
    sh.uniforms.uHatch = ghostAdd.material.userData.hatch;
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uHatch;").replace("#include <dithering_fragment>", "#include <dithering_fragment>\ngl_FragColor.a *= mix( 1.0, 0.25 + 0.75 * step( 0.5, fract( ( gl_FragCoord.x + gl_FragCoord.y ) / 11.0 ) ), uHatch );");
  };
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
    // a structure keeps its id through undo and saving; a copy or a new one takes the next free number
    const id = F.id && !B.structs.some((O) => O.id === F.id) ? F.id : B.nextId++;
    if (id >= B.nextId) B.nextId = id + 1;
    const S = {
      id,
      ver: 0,
      wid: new Map(),
      oid: new Map(),
      fid: new Map(),
      pids: [],
      asm: {},
      runs: [],
      fruns: [],
      free: [],
      fopen: [],
      doorGaps: new Map(),
      regs: [],
      pc: null,
      ser: null,
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
      // the dollhouse caps: shown only where the walls are cut (near, sideA and sideB all clip), so these are those planes reversed
      capPl: [new T.Plane(), new T.Plane(), new T.Plane()],
      cutH: 99,
      stairs: [],
      polyRoofs: [],
      polys: [],
      pillars: [],
      paths: [],
      po: !!F.po,
      hid: new Set(),
      decor: [],
      lights: [],
      beds: [],
      fires: [],
      ringCosy: [],
      glow: null,
      glowMat: new T.MeshBasicMaterial({ vertexColors: true }),
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
      found: F.found || "plinth",
      ins: F.ins || null,
      lining: F.lining === undefined ? "boards" : F.lining,
      deco: F.deco ? JSON.parse(JSON.stringify(F.deco)) : null,
      plan: new Set(),
      known: F.fresh ? new Set() : null,
      sitePlanned: !!F.fresh && B.cmode,
      mem: null,
      memMeshes: [],
    };
    S.wallMat = makeWallMat(S.clip, S.near, S.sideA, S.sideB);
    S.glassMat = makeGlassMat([S.clip, S.near, S.sideA, S.sideB]);
    S.memMats = memberMats([S.clip, S.near, S.sideA, S.sideB]);
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
    S.glassMat.dispose();
    if (S.memMats) for (const k in S.memMats) S.memMats[k].dispose();
    S.glassMesh && S.glassMesh.geometry.dispose();
    S.glow && S.glow.geometry.dispose();
    S.glowMat.dispose();
    dropMembers(S);
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

  // wall corners of every building standing on the same grid as a frame (its own included), in the frame's metres
  function gridCorners(F) {
    const out = [];
    for (const O of B.structs) {
      if (O.po || O.cx === undefined || (F.level !== undefined && O.level !== (F.level || 0)) || Math.hypot(O.cx - F.ox, O.cz - F.oz) > O.rad + 40) continue;
      for (const [ci, cj] of O.corners) {
        if (O === F) {
          out.push([ci, cj]);
          continue;
        }
        const [x, z] = toWorld(O, ci, cj),
          [lx, lz] = toLocal(F, x, z);
        if (Math.abs(lx - Math.round(lx)) < 1e-3 && Math.abs(lz - Math.round(lz)) < 1e-3) out.push([Math.round(lx), Math.round(lz)]);
      }
    }
    return out;
  }
  // after a structure changes, the terrain chunks under it are refreshed (a moment later, so a drag does it once)
  // to hide or bring back the grass and ground cover beneath its floors and paths
  // Building materials take the engine's see-through circle (the dithered hole that shows you behind things), but
  // with their own radius: indoors the dollhouse cut already opens the wall in the way, and the two together
  // punched a second, speckled hole through walls and roof. So the circle is switched off for buildings while you
  // are inside one; trees keep theirs.
  const fadeRB = { value: 1 };
  function fadeB(m) {
    G.fade(m, 0, 1, 0, true);
    const f = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => { f(sh, r); sh.uniforms.uFadeR = fadeRB; };
  }
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
    for (const p of S.polys) p.cov = p.roofed || S.roofs.some((r) => p.cx >= r.i0 && p.cx <= r.i1 + 1 && p.cz >= r.j0 && p.cz <= r.j1 + 1);
    identify(S);
    // a door in an angled wall leaves a way through it
    for (const o of S.fopen) {
      if (o.f.d !== "f" || o.sp.type.kind !== "door") continue;
      const lf = o.sp.leaf,
        a = o.f.pos + (lf && lf.a > 0 ? lf.a : -OP.ROUGH_GAP),
        b = o.f.pos + (lf && lf.b < o.sp.w - 1e-6 ? lf.b : o.sp.w + OP.ROUGH_GAP),
        g = o.g,
        next = [];
      for (const sg of S.colSegs) {
        const dx = sg[2] - sg[0],
          dz = sg[3] - sg[1],
          len = Math.hypot(dx, dz) || 1,
          ex = sg[0] - g.x0,
          ez = sg[1] - g.z0;
        if (sg[4] !== "wall" || Math.abs(Math.abs((dx * g.ux + dz * g.uz) / len) - 1) > 1e-3 || Math.abs(ex * g.uz - ez * g.ux) > 0.02) {
          next.push(sg);
          continue;
        }
        const s0 = ex * g.ux + ez * g.uz,
          s1 = (sg[2] - g.x0) * g.ux + (sg[3] - g.z0) * g.uz,
          lo = Math.min(s0, s1),
          hi = Math.max(s0, s1),
          P = (t) => [g.x0 + g.ux * t, g.z0 + g.uz * t];
        if (hi <= a || lo >= b) {
          next.push(sg);
          continue;
        }
        lo < a - 0.01 && next.push([...P(lo), ...P(a), "wall"]);
        hi > b + 0.01 && next.push([...P(b), ...P(hi), "wall"]);
      }
      S.colSegs = next;
    }
    const st = memberState(S),
      geo = buildGeo(st.all ? S : st.built, S.depth);
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
    if (S.glassMesh) {
      S.group.remove(S.glassMesh);
      S.glassMesh.geometry.dispose();
      S.glassMesh = null;
    }
    if (geo.glass.p.length) {
      S.glassMesh = new T.Mesh(geo.glass.build(), S.glassMat);
      S.glassMesh.renderOrder = 2;
      S.group.add(S.glassMesh);
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
    drawMembers(S, st);
    drawLeaves(S, st);
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
    // a door that is still only planned has no leaf to swing yet
    const doorways = S.rings.length ? S.colSegs.filter((sg) => isDoor(sg[4]) && !S.segs.some((q) => q[0] === sg[0] && q[1] === sg[1] && q[2] === sg[2] && q[3] === sg[3])).map((sg) => sg.slice(0, 5)) : [];
    for (const sg of S.segs) isDoor(sg[4]) && !S.plan.has(sg[7]) && !(S.rings.length && inRings(S, (sg[0] + sg[2]) / 2, (sg[1] + sg[3]) / 2)) && doorways.push(sg.slice(0, 5));
    for (const [k, type] of S.walls) {
      if (!isDoor(type) || S.hid.has(k) || S.plan.has(S.oid.get(k))) continue;
      const [i, j, d] = parse(k);
      doorways.push(d === 0 ? [i, j, i + 1, j, type] : [i, j, i, j + 1, type]);
    }
    for (const [x0, z0, x1, z1, kind] of doorways) {
      const dx = x1 - x0,
        dz = z1 - z0,
        len = Math.hypot(dx, dz) || 1,
        base = Math.atan2(-dz, dx),
        rec = { base, mx: (x0 + x1) / 2, mz: (z0 + z1) / 2, nx: -dz / len, nz: dx / len, open: 0, dir: 1, sign: 1, kind, reach: 1.7 };
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
    S.ver++;
    S.pc = null;
    S.snapV = -1;
    B.version++;
  }

  /* ---------- terrain ---------- */
  // Level the site under new pieces: cut and fill to floor height, with a blended rim.
  // Ground A3: the levelling goes through the sim's ground system (ground.grade, the same maths), which also fills any
  // hand-dug ground under the pad and redraws the terrain itself. The loops below are the old fallback (one release).
  function cutTerrain(S, samples, pit) {
    if (!samples.length) return;
    if (window.__foundation && window.__foundation.owns && window.__foundation.owns(S.id)) return; // dug by hand instead
    if (G.ground && samples.length <= 4096) {
      const r = G.ground.cmd("grade", { samples: samples.map(([x, z]) => [x, z]), targetY: S.y0 - dropOf(S), core: pit ? 0.8 : 1.05, rim: pit ? 0.801 : 2.9, pit: !!pit });
      if (r && r.ok) return;
    }
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
    const target = S.y0 - dropOf(S),
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
    op.swaps = op.setMats.length + op.setFmats.length + op.setSegMats.length + op.setPillars.length;
    op.adds = op.swaps + op.addFloors.length + op.addWalls.length + op.setTypes.length + op.addRoofs.length + op.addSegs.length + op.addRings.length + op.addPillars.length + op.addDecor.length + op.addPaths.length + op.addStairs.length + op.addPolyRoofs.length + op.setSegs.length + op.setSides.filter((x) => x[2]).length + op.ringRoofs.filter((x) => x[1]).length + op.addFree.length;
    op.dels = op.delFloors.length + op.delWalls.length + op.delRoofs.length + op.revert.length + op.delSegs.length + op.delRings.length + op.delPillars.length + op.delDecor.length + op.delPaths.length + op.delStairs.length + op.delPolyRoofs.length + op.setSides.filter((x) => !x[2]).length + op.ringRoofs.filter((x) => !x[1]).length + op.delFree.filter((id) => !op.addFree.some((f) => f.id === id)).length;
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
  const STYLE_NAME = { wall: "Wall", arch: "Round arches", arch2: "Pointed arches", arch3: "Braced openings", rail: "Fence" };
  const WIN_NAME = { window: "Square window", window2: "Arched window", window4: "Shuttered window" };
  const DOOR_NAME = { door: "Door", door2: "Double door" };
  const blankOp = (F) => ({ F, addFloors: [], addWalls: [], setTypes: [], setMats: [], setFmats: [], setSegMats: [], setPillars: [], addRoofs: [], delFloors: [], delWalls: [], delRoofs: [], revert: [], addSegs: [], addRings: [], delSegs: [], delRings: [], setSegs: [], setSides: [], ringRoofs: [], addStairs: [], delStairs: [], addPillars: [], delPillars: [], addPolyRoofs: [], delPolyRoofs: [], addPaths: [], delPaths: [], addDecor: [], delDecor: [], addFree: [], delFree: [], label: "", marker: null, dims: [], guides: [] });

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

  // numbers as the player reads them: up to two decimals, no trailing zeros
  const fmt = (v) => String(Math.round(v * 100) / 100);
  const fmtM = (v) => fmt(v) + " m";
  const fmtA = (v) => String(Math.round(v * 10) / 10) + " m²";
  const tidy = (v) => (Math.abs(v * 2 - Math.round(v * 2)) < 1e-6 ? Math.round(v * 2) / 2 : v);
  const isInt = Number.isInteger;
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");
  const baseType = (cls) => (cls === "rail" ? "rail" : "wall");
  // a live dimension shown on the ghost; field says which typed value it stands for
  const dim = (op, lx, lz, text, field, val, unit) => op.dims.push({ lx, lz, text, field: field || "", val: val === undefined ? null : val, unit: unit || "" });
  // the wall under the cursor, found on the face you point at, else by its foot
  function wallUnder(h) {
    const pk = pickAt(WALLS_ONLY);
    if (pk) return pk;
    const S = h.F.isNew ? null : h.F;
    if (!S) return null;
    const e = nearestEdge(S, h.lx, h.lz, true),
      fp = pickFree(S, h.lx, h.lz);
    if (fp && fp.dist < 0.5 && (!e || fp.dist < e[3])) return fp.kind === "seg" ? { S, kind: "wall", free: true, idx: fp.idx, type: fp.type } : { S, kind: "ring", ri: fp.ri, side: fp.k, type: fp.type };
    if (e && e[3] < 0.5) return { S, kind: "wall", i: e[0], j: e[1], d: e[2], type: S.walls.get(ek(e[0], e[1], e[2])) };
    return null;
  }

  // what already stands in a wall run, as rough extents along it: module doors and windows and free ones
  function runOthers(S, g, skipId) {
    const out = [];
    if (g.free)
      for (const q of g.mods) {
        const sp = OPEN[q.type];
        sp && sp.kind !== "opening" && out.push({ a: q.s + sp.t0 * q.len, b: q.s + sp.t1 * q.len, sill: sp.y0, head: sp.y1 });
      }
    else
      for (const e of g.m) {
        const sp = OPEN[e.type];
        sp && sp.kind !== "opening" && out.push({ a: e.t - g.t0 + sp.t0, b: e.t - g.t0 + sp.t1, sill: sp.y0, head: sp.y1 });
      }
    for (const o of S.fopen) o.g === g && o.f.id !== skipId && out.push({ a: o.off - OP.ROUGH_GAP, b: o.off + o.sp.w + OP.ROUGH_GAP, sill: o.sp.rough.sill, head: o.sp.head });
    return out;
  }
  function computeOp() {
    const h = B.hover;
    if (!h) return null;
    let F = h.F,
      S = F.isNew ? null : F,
      op = blankOp(F);
    const t = B.tool,
      d = B.drag,
      ty = B.typed;
    const vtx = { i: Math.round(h.lx), j: Math.round(h.lz) },
      cell = { i: Math.floor(h.lx), j: Math.floor(h.lz) },
      pt = { i: h.sx, j: h.sz };
    const size = (w, l) => w + " × " + l + " m";
    op.snap = h.snap;
    if (h.guides) for (const g of h.guides) op.guides.push(g);
    if (t === "select" || t === "measure" || t === "copy") {
      op.idle = true;
      op.valid = false;
      return op;
    }
    if (t === "pillar") {
      const pts = [],
        name = B.pkind === "chimney" ? "chimney" : "pillar";
      if (d && Math.hypot(pt.i - d.a.i, pt.j - d.a.j) > 0.45) {
        // a drag stands a row of them, evenly spaced
        let dx = pt.i - d.a.i,
          dz = pt.j - d.a.j,
          L = Math.hypot(dx, dz);
        if (ty.a) ((dx *= ty.a / L), (dz *= ty.a / L), (L = ty.a));
        const n = Math.max(1, Math.round(L / B.gap));
        for (let m = 0; m <= n; m++) pts.push([tidy(d.a.i + (dx * m) / n), tidy(d.a.j + (dz * m) / n)]);
        op.end = { i: d.a.i + dx, j: d.a.j + dz };
        dim(op, d.a.i + dx / 2, d.a.j + dz / 2, fmtM(L), "a", L, "m");
        op.label = plural(n + 1, name) + " · " + fmtM(L / n) + " apart";
      } else pts.push(d ? [d.a.i, d.a.j] : [pt.i, pt.j]);
      for (const [x, z] of pts) {
        const near = S ? S.pillars.findIndex((p) => Math.hypot(p[0] - x, p[1] - z) < 0.4) : -1;
        if (B.alt) near >= 0 && !op.delPillars.includes(near) && op.delPillars.push(near);
        else if (near < 0) op.addPillars.push([x, z, B.wmat, B.pkind]);
        else {
          // one already stands here: a different kind or material replaces it, the same one is picked up
          const p = S.pillars[near];
          if ((p[2] || "timber") !== B.wmat || (p[3] || "pillar") !== B.pkind) op.setPillars.push([near, B.wmat, B.pkind]);
          else if (pts.length === 1) ((op.note = "This " + name + " is already here"), (op.pick = p[4]));
        }
      }
      op.label = op.label || (B.pkind === "chimney" ? "Chimney" : "Pillar");
      op.marker = pts.length === 1 && !op.addPillars.length ? pts[0] : null;
      return finishOp(op);
    }
    if (t === "decor" && DECOR[B.dkind].shut) {
      // shutters go on a window: the one under the pointer
      const hit = S ? wallUnder(h) : null,
        run = hit && hit.kind === "wall" && !hit.free ? hit.run || hit.S.runs.find((g) => g.m.some((e) => e.i === hit.i && e.j === hit.j && e.d === hit.d)) : null,
        along = run ? (hit.u !== undefined && hit.run ? run.t0 + hit.u * (run.t1 - run.t0) : run.d === 0 ? h.lx : h.lz) : 0,
        o = run ? hit.S.fopen.find((q) => q.g === run && q.sp.type.kind === "window" && along >= q.f.pos - 0.3 && along <= q.f.pos + q.sp.w + 0.3) : null,
        v = DECOR[B.dkind].shut;
      if (!o) return ((op.note = "Point at a window to hang shutters on it"), (op.valid = false), op);
      const shape = o.sp.look.shape || "rect";
      op.valid = false;
      op.idle = true;
      if (v !== "none" && ((shape !== "rect" && shape !== "arch") || o.sp.w >= 2.2)) return ((op.note = "Shutters suit a plain or round-top window under 2.2 m wide"), (op.idle = false), op);
      op.shut = { S: hit.S, id: o.f.id, v };
      op.label = v === "none" ? "Take the shutters off this window" : "Hang " + DECOR[B.dkind].name.toLowerCase() + " on this window";
      return op;
    }
    if (t === "decor") {
      const near = S ? nearestDecor(S, h.lx, h.lz, 0.6) : -1;
      if (B.alt) {
        if (near >= 0) (op.delDecor.push(near), (op.label = "Remove the " + DECOR[S.decor[near][2]].name.toLowerCase()));
        return finishOp(op);
      }
      const def = DECOR[B.dkind],
        free = !snapOn();
      let x = free ? h.lx : Math.round(h.lx * 4) / 4,
        z = free ? h.lz : Math.round(h.lz * 4) / 4,
        rot = B.drot;
      if (def.wall && S && !free) {
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
      const here = S ? S.decor.find((q) => Math.hypot(q[0] - x, q[1] - z) < (q[2] === B.dkind ? 0.2 : 0.02)) : null;
      if (F.level && !(S && onFloorAt(S, x, z))) op.note = "It needs a floor up here";
      else if (here) ((op.note = "Click to select this " + DECOR[here[2]].name.toLowerCase()), (op.pick = here[5]));
      else op.addDecor.push([x, z, B.dkind, rot, B.dcol]);
      op.label = def.name + (def.wall && !op.snapped ? " · snaps to walls" : "");
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
        } else op.marker = [pt.i, pt.j];
        return finishOp(op);
      }
      let dx = pt.i - d.a.i,
        dz = pt.j - d.a.j,
        L = Math.hypot(dx, dz);
      if (ty.b !== null && L > 1e-6) {
        const an = (ty.b * Math.PI) / 180;
        dx = Math.cos(an) * L * (dx < 0 ? -1 : 1);
        dz = Math.sin(an) * L * (dz < 0 ? -1 : 1);
      }
      if (ty.a && L > 1e-6) ((dx *= ty.a / L), (dz *= ty.a / L), (L = ty.a));
      const b = { i: tidy(d.a.i + dx), j: tidy(d.a.j + dz) };
      op.end = b;
      op.marker = [b.i, b.j];
      if (L > 0.4) {
        op.addPaths.push([d.a.i, d.a.j, b.i, b.j, B.pwidth, B.pmat]);
        dim(op, (d.a.i + b.i) / 2, (d.a.j + b.j) / 2, fmtM(L), "a", L, "m");
      }
      return finishOp(op);
    }
    if (t === "stairs") {
      const a0 = d ? d.a : cell;
      let dir = B.stairDir;
      if (d && (cell.i !== a0.i || cell.j !== a0.j)) dir = Math.abs(cell.i - a0.i) >= Math.abs(cell.j - a0.j) ? (cell.i > a0.i ? 0 : 2) : cell.j > a0.j ? 1 : 3;
      const here = S ? S.stairs.find((st) => st.i === a0.i && st.j === a0.j && st.dir === dir) : null;
      if (!S) {
        op.marker = [vtx.i, vtx.j];
        op.note = "Stairs start on a floor";
      } else if (here) ((op.note = "Stairs are already here"), (op.pick = here.id));
      else {
        op.addStairs.push({ i: a0.i, j: a0.j, dir });
        op.label = "Stairs up " + fmtM(EAVE * S.hs) + " · " + stairLen(S.hs) + " m long";
      }
      return finishOp(op);
    }
    if (t === "tower") {
      op.marker = d ? [d.a.i, d.a.j] : [pt.i, pt.j];
      if (d) {
        const dist = ty.a ? ty.a / 2 : Math.hypot(h.lx - d.a.i, h.lz - d.a.j);
        if (dist > 0.8) {
          const r = ty.a ? clamp(dist, 1.5, 9) : clamp(snapOn() ? Math.round(dist * 2) / 2 : dist, 1.5, 9),
            n = clamp(Math.round((Math.PI * 2 * r) / 1.05 / 2) * 2, 8, 32);
          op.addRings.push({ cx: d.a.i, cz: d.a.j, r, n, rot: Math.PI / n, h: B.levels, sides: Array(n).fill("wall"), roof: false });
          dim(op, d.a.i, d.a.j, fmtM(r * 2) + " wide", "a", r * 2, "m wide");
          dim(op, d.a.i, d.a.j + r * 0.55, fmtA(0.5 * n * r * r * Math.sin((2 * Math.PI) / n)));
          op.label = n + " sides · " + plural(B.levels, "storey") + (r >= 2 && B.levels > 1 ? " · spiral stair inside" : "");
        }
      }
      return finishOp(op);
    }
    if (t === "wall") {
      if (!d) {
        op.marker = [pt.i, pt.j];
        return finishOp(op);
      }
      const a = d.a;
      let dx = pt.i - a.i,
        dz = pt.j - a.j,
        L = Math.hypot(dx, dz);
      // typed values: an angle is measured from the grid, on the cursor's side; a length runs along it
      if (ty.b !== null && L > 1e-6) {
        const an = (ty.b * Math.PI) / 180;
        dx = Math.cos(an) * L * (dx < 0 ? -1 : 1);
        dz = Math.sin(an) * L * (dz < 0 ? -1 : 1);
      }
      if (ty.a && L > 1e-6) ((dx *= ty.a / L), (dz *= ty.a / L), (L = ty.a));
      const b = { i: tidy(a.i + dx), j: tidy(a.j + dz) };
      L = Math.hypot(b.i - a.i, b.j - a.j);
      op.end = b;
      op.marker = [b.i, b.j];
      op.style = B.style;
      if (L > 0.4) {
        const onGrid = isInt(a.i) && isInt(a.j) && isInt(b.i) && isInt(b.j) && (a.i === b.i || a.j === b.j);
        if (onGrid) {
          const x = a.j === b.j,
            lo = Math.min(x ? a.i : a.j, x ? b.i : b.j),
            hi = Math.max(x ? a.i : a.j, x ? b.i : b.j);
          for (let m = lo; m < hi; m++) {
            const e = x ? [m, a.j, 0] : [a.i, m, 1],
              k = ek(e[0], e[1], e[2]),
              cur = S ? S.walls.get(k) : undefined;
            if (B.alt) cur && op.delWalls.push(e);
            else if (!cur) op.addWalls.push(e);
            else {
              // drawing over a wall restyles it: a new style or material takes the old one's place, doors and windows stay
              if (cur !== B.style && !isDoor(cur) && !isWin(cur)) op.setTypes.push([e[0], e[1], e[2], B.style]);
              if ((S.wmat.get(k) || "timber") !== B.wmat) op.setMats.push([e[0], e[1], e[2], B.wmat]);
            }
          }
        } else if (B.alt) {
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
            const dup = S ? S.segs.findIndex((sg) => Math.min(Math.abs(sg[0] - p[0]) + Math.abs(sg[1] - p[1]) + Math.abs(sg[2] - p[2]) + Math.abs(sg[3] - p[3]), Math.abs(sg[0] - p[2]) + Math.abs(sg[1] - p[3]) + Math.abs(sg[2] - p[0]) + Math.abs(sg[3] - p[1])) < 0.05) : -1;
            if (dup < 0) op.addSegs.push([...p, B.style]);
            else {
              const sg = S.segs[dup];
              if (sg[4] !== B.style && !isDoor(sg[4]) && !isWin(sg[4])) op.setSegs.push([dup, B.style]);
              if ((sg[5] || "timber") !== B.wmat) op.setSegMats.push([dup, B.wmat]);
            }
          }
        }
        const an = (Math.atan2(Math.abs(b.j - a.j), Math.abs(b.i - a.i)) * 180) / Math.PI,
          square = an < 0.01 || an > 89.99;
        dim(op, (a.i + b.i) / 2, (a.j + b.j) / 2, fmtM(L), "a", L, "m");
        if (!square || ty.b !== null) dim(op, a.i + (b.i - a.i) * 0.14, a.j + (b.j - a.j) * 0.14, fmt(an) + "°", "b", an, "°");
        else op.fieldB = { val: an, unit: "°" };
        op.restyle = !op.addWalls.length && !op.addSegs.length && op.setTypes.length + op.setMats.length + op.setSegs.length + op.setSegMats.length > 0;
        if (op.restyle) op.label = "Restyle as " + STYLE_NAME[B.style].toLowerCase() + ", " + WALLS[B.wmat].name.toLowerCase();
      }
      return finishOp(op);
    }
    if (t === "room") {
      if (!d) {
        op.marker = [vtx.i, vtx.j];
        return finishOp(op);
      }
      const a = d.a;
      let b = { i: vtx.i, j: vtx.j };
      // typed width and depth, in whole metres, on the cursor's side of the start corner
      if (ty.a) b.i = a.i + Math.max(1, Math.round(ty.a)) * (h.lx < a.i ? -1 : 1);
      if (ty.b) b.j = a.j + Math.max(1, Math.round(ty.b)) * (h.lz < a.j ? -1 : 1);
      const di = Math.abs(b.i - a.i),
        dj = Math.abs(b.j - a.j);
      if (di === 0 || dj === 0) {
        // a straight drag is a single wall
        op.end = b;
        op.marker = [b.i, b.j];
        const len = Math.max(di, dj);
        if (B.alt) {
          const lo = { i: Math.min(a.i, b.i), j: Math.min(a.j, b.j) },
            hi = { i: Math.max(a.i, b.i), j: Math.max(a.j, b.j) };
          if (S)
            for (const k of S.walls.keys()) {
              const [i, j, dd] = parse(k);
              if (a.j === b.j ? dd === 0 && j === a.j && i >= lo.i && i < hi.i : dd === 1 && i === a.i && j >= lo.j && j < hi.j) op.delWalls.push([i, j, dd]);
            }
        } else lineOps(op, S, a, b);
        if (len) dim(op, (a.i + b.i) / 2, (a.j + b.j) / 2, fmtM(len), di ? "a" : "b", len, "m");
      } else {
        const i0 = Math.min(a.i, b.i),
          i1 = Math.max(a.i, b.i) - 1,
          j0 = Math.min(a.j, b.j),
          j1 = Math.max(a.j, b.j) - 1;
        if (B.alt) eraseRect(op, S, i0, j0, i1, j1);
        else rectOps(op, S, i0, j0, i1, j1, true, true);
        op.end = b;
        dim(op, (a.i + b.i) / 2, a.j, fmtM(di), "a", di, "m");
        dim(op, a.i, (a.j + b.j) / 2, fmtM(dj), "b", dj, "m");
        dim(op, (a.i + b.i) / 2, (a.j + b.j) / 2, fmtA(di * dj));
        if (B.alt) op.label = "Clear " + size(di, dj);
      }
      return finishOp(op);
    }
    if (t === "floor") {
      const a = d ? d.a : cell;
      let ci = cell.i,
        cj = cell.j;
      if (d && ty.a) ci = a.i + (Math.max(1, Math.round(ty.a)) - 1) * (h.lx < a.i ? -1 : 1);
      if (d && ty.b) cj = a.j + (Math.max(1, Math.round(ty.b)) - 1) * (h.lz < a.j ? -1 : 1);
      const i0 = Math.min(a.i, ci),
        i1 = Math.max(a.i, ci),
        j0 = Math.min(a.j, cj),
        j1 = Math.max(a.j, cj);
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const has = S && S.floors.has(ck(i, j));
          if (B.alt) has && op.delFloors.push([i, j]);
          else if (!has) op.addFloors.push([i, j]);
          else if ((S.fmat.get(ck(i, j)) || "planks") !== B.fmat) op.setFmats.push([i, j, B.fmat]);   // laying a new surface over an old one replaces it
        }
      if (d) {
        const w = i1 - i0 + 1,
          l = j1 - j0 + 1,
          ax = ci >= a.i ? i0 : i1 + 1,
          az = cj >= a.j ? j0 : j1 + 1;
        dim(op, (i0 + i1 + 1) / 2, az, fmtM(w), "a", w, "m");
        dim(op, ax, (j0 + j1 + 1) / 2, fmtM(l), "b", l, "m");
        dim(op, (i0 + i1 + 1) / 2, (j0 + j1 + 1) / 2, fmtA(w * l));
        if (!op.addFloors.length && op.setFmats.length) op.label = "Relay as " + FLOORS[B.fmat].name.toLowerCase();
      }
      return finishOp(op);
    }
    if (freeTool()) {
      const f0 = { typeId: B.otype, sizeIdx: B.osize, sill: OP.sillFor(B.otype, B.osill), ...designOf(), ...nextDesign() },
        sp0 = OP.freeSpec(f0),
        hit = h.F.isNew ? null : wallUnder(h);
      op.label = sp0.type.name + " " + fmtM(sp0.w) + " × " + fmtM(sp0.h);
      const run = hit && hit.kind === "wall" ? (hit.free ? hit.run || hit.S.fruns.find((g) => g.m.includes(hit.idx)) : hit.run || hit.S.runs.find((g) => g.m.some((e) => e.i === hit.i && e.j === hit.j && e.d === hit.d))) : null;
      if (!run) {
        op.marker = [vtx.i, vtx.j];
        op.note = hit && hit.kind === "ring" ? "Round walls take the rustic styles" : "Doors and windows go in walls";
        return finishOp(op);
      }
      F = S = hit.S;
      op = blankOp(F);
      const ax = runAx(S, run),
        L = ax.t1 - ax.t0,
        wp = hit.u === undefined || hit.y === undefined ? wallPtF(S, ax.F0) : null,
        along = hit.u !== undefined && hit.run ? ax.t0 + hit.u * L : wp ? wp.u : run.d === 0 ? h.lx : h.lz,
        over = S.fopen.find((o) => o.g === run && along >= o.f.pos - 0.05 && along <= o.f.pos + o.sp.w + 0.05),
        grab = d && d.fgrab ? S.fopen.find((o) => o.f.id === d.fgrab) : null;
      if (!grab && over && !d) {
        B.fover = over.f.id;
        op.label = over.sp.type.name;
        op.note = "Click to select it, drag to move it";
        op.idle = true;
        op.valid = false;
        return op;
      }
      B.fover = null;
      const mine = grab ? grab.f : null,
        spec = mine ? grab.sp : sp0,
        door = spec.type.kind === "door",
        Hh = EAVE * S.hs,
        snapping = snapOn() && !B.ctrl,
        // the window follows the pointer up and down too: centred on it, pulled to its usual sill, kept inside the wall
        base = mine ? mine.sill : f0.sill,
        py = door ? null : hit.y !== undefined ? hit.y : wp ? wp.y : null,
        loS = 0.1,
        hiS = Hh - 0.19 - spec.h - OP.ROUGH_GAP;
      let want = base,
        vsnap = "";
      if (py !== undefined && py !== null && (!mine || d)) {
        const c = py - spec.h / 2;
        want = !snapping ? Math.round(c * 100) / 100 : Math.abs(c - base) < 0.18 ? base : Math.round(c * 20) / 20;
        if (snapping && want === base && Math.abs(c - base) > 0.01) vsnap = mine ? "Same height as before" : "Usual sill height";
      }
      const sn = OP.snapFree({ L, at: along - ax.t0, w: spec.w, h: spec.h, sill: Math.max(loS, Math.min(hiS, want)), others: runOthers(S, run, mine && mine.id), snap: snapping }),
        f = { id: mine ? mine.id : null, typeId: mine ? mine.typeId : B.otype, sizeIdx: mine ? mine.sizeIdx : B.osize, ...ax.at(ax.t0 + sn.offset), sill: door ? 0 : Math.round(Math.max(loS, Math.min(hiS, sn.sill)) * 1000) / 1000, flip: mine ? !!mine.flip : B.oflip, ...(mine ? keepDesign(mine) : { ...designOf(), ...nextDesign() }) },
        sp = OP.freeSpec(f);
      f.out = freeOut(S, f, sp.w);
      let ok = sn.ok,
        why = sn.reason;
      const a = f.pos - OP.ROUGH_GAP,
        b = f.pos + sp.w + OP.ROUGH_GAP;
      if (ok && run.cls !== "wall") ((ok = false), (why = "Needs a plain wall"));
      if (ok && (run.free ? run.mods.some((q) => q.s + q.len > a + 1e-6 && q.s < b - 1e-6 && q.type !== "wall") : run.m.some((e) => e.t + 1 > a && e.t < b && e.type !== "wall"))) ((ok = false), (why = "A rustic door or window is in the way"));
      if (ok && sp.rough.sill + sp.rough.height + 0.19 > Hh + 1e-6) ((ok = false), (why = (door ? "This door" : "This window") + " is " + fmtM(sp.h) + " tall; this wall takes up to " + fmtM(Math.max(0, Hh - 0.19 - (door ? 0.02 + 2 * OP.ROUGH_GAP : loS + OP.ROUGH_GAP)) ) + ". Make it shorter in the designer"));
      op.label = sp.type.name + " " + fmtM(sp.w) + " × " + fmtM(sp.h) + (door ? "" : " · sill " + fmtM(sp.sill));
      if (mine) op.delFree.push(mine.id);
      op.addFree.push(f);
      const notes = [sn.snap, sn.headLine ? "Head in line with its neighbour" : vsnap];
      if (!door && hiS >= loS && (want > hiS + 0.02 || want < loS - 0.02)) notes.push(want > hiS ? "Up against the top plate" : "Down at the floor");
      if (notes.some(Boolean)) op.note = notes.filter(Boolean).join(" · ");
      if (!run.free && sn.guides.some((q) => q.y !== undefined)) op.hline = { d: run.d, line: run.line, a: run.t0, b: run.t1, y: sn.guides.find((q) => q.y !== undefined).y };
      for (const q of sn.guides) {
        if (q.x === undefined) continue;
        const p0 = P3(ax.F0, ax.t0 + q.x, 0, -0.7),
          p1 = P3(ax.F0, ax.t0 + q.x, 0, 0.7);
        op.guides.push([p0[0], p0[2], p1[0], p1[2]]);
      }
      // live sizes on the ghost: its gaps to what is either side, and its sill
      const gaps = gapsBeside(S, run, f, sp);
      for (const q of gaps) op.dims.push(q);
      if (mine && Math.abs(mine.pos - f.pos) < 1e-6 && Math.abs(mine.sill - f.sill) < 1e-6 && mine.d === f.d && mine.line === f.line && mine.gx === f.gx && mine.gz === f.gz) ((op.addFree.length = op.delFree.length = 0), (op.idle = true), (op.valid = false), (op.note = ""));
      finishOp(op);
      if (!ok) ((op.valid = false), (op.reason = why), (op.idle = false));
      return op;
    }
    if (t === "door" || t === "window") {
      const want = t === "window" ? B.wstyle : B.dstyle,
        names = t === "window" ? WIN_NAME : DOOR_NAME,
        hit = wallUnder(h),
        fit = (cur) => (t === "door" && isLow(cur) ? "railgate" : want);
      op.label = names[want];
      if (!hit) {
        op.marker = [vtx.i, vtx.j];
        op.note = t === "door" ? "Doors hang in walls" : "Windows go in walls";
        return finishOp(op);
      }
      F = S = hit.S;
      op = blankOp(F);
      op.label = names[want];
      const one = (cur, put, id) => {
        const tt = fit(cur);
        if (tt === "railgate") op.label = "Gate";
        if (cur !== tt) put(tt);
        else if (!op.rowN) ((op.note = "Click to select this " + t), (op.pick = id));
      };
      const st = d && d.hit && d.hit.S === S ? d.hit : null;
      if (hit.kind === "ring") one(S.rings[hit.ri].sides[hit.side], (tt) => op.setSides.push([hit.ri, hit.side, tt]), S.rings[hit.ri].id + ".s" + hit.side + ".o0");
      else if (hit.free) {
        // along an angled wall: a drag sets a row of them at even spacing
        const run = S.fruns.find((g) => g.m.includes(hit.idx)),
          from = st && st.free && run && run.m.includes(st.idx) ? run.m.indexOf(st.idx) : -1,
          to = run ? run.m.indexOf(hit.idx) : -1;
        if (from >= 0 && from !== to) {
          op.rowN = 0;
          for (let m = from; from < to ? m <= to : m >= to; m += from < to ? B.gap : -B.gap) (op.rowN++, one(S.segs[run.m[m]][4], (tt) => op.setSegs.push([run.m[m], tt])));
        } else one(S.segs[hit.idx][4], (tt) => op.setSegs.push([hit.idx, tt]), S.segs[hit.idx][7]);
      } else {
        const sameLine = st && !st.free && st.kind === "wall" && st.d === hit.d && (hit.d === 0 ? st.j === hit.j : st.i === hit.i),
          from = sameLine ? (hit.d === 0 ? st.i : st.j) : -1,
          to = hit.d === 0 ? hit.i : hit.j;
        if (sameLine && from !== to) {
          op.rowN = 0;
          for (let m = from; from < to ? m <= to : m >= to; m += from < to ? B.gap : -B.gap) {
            const e = hit.d === 0 ? [m, hit.j, 0] : [hit.i, m, 1],
              cur = S.walls.get(ek(e[0], e[1], e[2]));
            if (!cur) continue;
            op.rowN++;
            one(cur, (tt) => op.setTypes.push([e[0], e[1], e[2], tt]));
          }
        } else one(S.walls.get(ek(hit.i, hit.j, hit.d)), (tt) => op.setTypes.push([hit.i, hit.j, hit.d, tt]), S.oid.get(ek(hit.i, hit.j, hit.d)));
      }
      if (op.rowN) op.label = plural(op.rowN, names[want].toLowerCase()) + (B.gap > 1 ? " · one every " + B.gap + " m" : " · side by side");
      return finishOp(op);
    }
    if (t === "roof") {
      const dragging = d && (d.a.i !== cell.i || d.a.j !== cell.j);
      if (!dragging && S && ringAt(S, h.lx, h.lz) >= 0) {
        const ri = ringAt(S, h.lx, h.lz),
          r = S.rings[ri];
        if (B.alt) r.roof && op.ringRoofs.push([ri, false]);
        else if ((r.roof === true ? "cone" : r.roof) === B.tshape && (r.rmat || "thatch") === B.rmat) op.note = "It already has this top";
        else op.ringRoofs.push([ri, B.tshape]);
        op.label = TOP_NAME[B.tshape];
        return finishOp(op);
      }
      if (!dragging && S && polyAt(S, h.lx, h.lz) >= 0) {
        const pi = polyAt(S, h.lx, h.lz),
          p = S.polys[pi];
        if (B.alt) p.roofed && op.delPolyRoofs.push(pi);
        else if (p.roofed && (p.rmat || "thatch") === B.rmat) ((op.note = "Click to select this roof"), (op.pick = p.roofId));
        else {
          p.roofed && op.delPolyRoofs.push(pi);
          op.addPolyRoofs.push([p.cx, p.cz, p.area]);
          op.replacing = p.roofed;
        }
        op.label = "Pointed roof · " + ROOFS[B.rmat].name.toLowerCase();
        return finishOp(op);
      }
      let rect = null;
      if (dragging) rect = { i0: Math.min(d.a.i, cell.i), i1: Math.max(d.a.i, cell.i), j0: Math.min(d.a.j, cell.j), j1: Math.max(d.a.j, cell.j) };
      else if (S) {
        // over a roof that is already there, work on that roof; otherwise roof the room under the cursor
        const ri = h.rlx === undefined ? -1 : S.roofs.findIndex((r) => h.rlx >= r.i0 - 0.4 && h.rlx <= r.i1 + 1.4 && h.rlz >= r.j0 - 0.4 && h.rlz <= r.j1 + 1.4),
          room = S.cellRoom.get(ck(cell.i, cell.j));
        if (ri >= 0) rect = { i0: S.roofs[ri].i0, i1: S.roofs[ri].i1, j0: S.roofs[ri].j0, j1: S.roofs[ri].j1 };
        else if (room) rect = { i0: room.i0, i1: room.i1, j0: room.j0, j1: room.j1 };
      }
      if (rect) {
        Object.assign(rect, roofFromHand(rect));
        if (B.alt) {
          S && S.roofs.forEach((r, idx) => !(r.i1 < rect.i0 || r.i0 > rect.i1 || r.j1 < rect.j0 || r.j0 > rect.j1) && op.delRoofs.push(idx));
        } else {
          const same = S ? S.roofs.findIndex((r) => r.i0 === rect.i0 && r.i1 === rect.i1 && r.j0 === rect.j0 && r.j1 === rect.j1) : -1,
            old = same >= 0 ? S.roofs[same] : null;
          if (old && sameRoofPlan(old, rect)) ((op.note = "Click to select this roof"), (op.pick = old.id));
          else {
            // a different shape or covering over an existing roof replaces it in place
            old && (op.delRoofs.push(same), (rect.id = old.id));
            op.addRoofs.push(rect);
            op.replacing = !!old;
          }
        }
        const st = roofStats(rect),
          warn = roofWarnings(rect.mat, st.lo, st.hi, rect.shape === "flat" ? 0 : rect.eave);
        op.label = (op.replacing ? "Re-roof: " : "") + ROOF_LONG[rect.shape] + " " + size(rect.i1 - rect.i0 + 1, rect.j1 - rect.j0 + 1) + " · " + ROOFS[rect.mat].name.toLowerCase() + " · " + (rect.shape === "flat" ? "flat" : p12Text(pitchOf(rect)) + " " + Math.round(degOf(pitchOf(rect))) + "°") + " · " + fmtA(st.area) + (warn.length ? " · " + warn.map((w) => w.text).join(" · ") : "");
      } else {
        op.marker = [vtx.i, vtx.j];
        op.note = "Click inside a room, or drag a rectangle";
      }
      return finishOp(op);
    }
    if (t === "erase") {
      if (d && (d.a.i !== cell.i || d.a.j !== cell.j)) {
        eraseRect(op, S, Math.min(d.a.i, cell.i), Math.min(d.a.j, cell.j), Math.max(d.a.i, cell.i), Math.max(d.a.j, cell.j));
        op.label = "Clear " + size(Math.abs(d.a.i - cell.i) + 1, Math.abs(d.a.j - cell.j) + 1);
        return finishOp(op);
      }
      const pk = pickAt(ANY_PIECE);
      if (pk) {
        F = S = pk.S;
        op = blankOp(F);
        eraseOne(op, pk, h);
      }
      return finishOp(op);
    }
    return finishOp(op);
  }
  // what one click of Remove takes away: the piece you point at, or the 1 m of wall under the cursor
  function eraseOne(op, pk, h) {
    const S = pk.S;
    if (pk.kind === "roof") op.delRoofs.push(S.roofs.indexOf(pk.r));
    else if (pk.kind === "polyroof") op.delPolyRoofs.push(pk.pi);
    else if (pk.kind === "ringroof") op.ringRoofs.push([pk.ri, false]);
    else if (pk.kind === "decor") op.delDecor.push(pk.idx);
    else if (pk.kind === "pillar") op.delPillars.push(pk.idx);
    else if (pk.kind === "stair") op.delStairs.push(pk.idx);
    else if (pk.kind === "path") op.delPaths.push(pk.idx);
    else if (pk.kind === "ring") {
      if (pk.side === undefined) op.delRings.push(pk.ri);
      else if (isDoor(pk.type) || isWin(pk.type)) op.setSides.push([pk.ri, pk.side, "wall"]);
      else op.setSides.push([pk.ri, pk.side, null]);
    } else if (pk.kind === "wall" && pk.free) {
      if (isDoor(pk.type) || isWin(pk.type)) op.setSegs.push([pk.idx, pk.type === "railgate" ? "rail" : "wall"]);
      else op.delSegs.push(pk.idx);
    } else if (pk.kind === "wall") {
      isDoor(pk.type) || isWin(pk.type) ? op.revert.push([pk.i, pk.j, pk.d]) : op.delWalls.push([pk.i, pk.j, pk.d]);
    } else if (pk.kind === "floor") {
      if (pk.poly !== undefined) op.note = "Remove one of its walls to open this floor";
      else op.delFloors.push([pk.ci, pk.cj]);
    }
    op.label = "Remove";
  }

  // A structure as plain data. The result is kept until the structure next changes, so undo steps share the
  // structures they did not touch. Nothing may change it afterwards: fill() copies what it takes.
  function serial(S) {
    if (S.ser && S.ser.ver === S.ver) return S.ser.data;
    const data = {
      id: S.id, ox: S.ox, oz: S.oz, yaw: S.yaw, y0: S.y0, level: S.level, hs: S.hs, lift: S.lift, po: S.po,
      floors: [...S.floors], walls: [...S.walls], wmat: [...S.wmat], fmat: [...S.fmat],
      roofs: S.roofs.map((r) => ({ ...r })), segs: S.segs.map((x) => x.slice()), rings: S.rings.map((r) => ({ ...r, sides: r.sides.slice() })),
      stairs: S.stairs.map((x) => ({ ...x })), pillars: S.pillars.map((x) => x.slice()), paths: S.paths.map((x) => x.slice()), decor: S.decor.map((x) => x.slice()),
      polyRoofs: S.polyRoofs.map((x) => x.slice()),
      // piece ids of walls and floors: one entry per run or area is enough to find the rest again
      ids: { walls: S.runs.map((g) => [g.m[0].k, g.id]), open: [...S.oid], floors: S.regs.map((g) => [g.m[0], g.id]), polys: S.pids.map((x) => x.slice()) },
    };
    if (S.free.length) data.free = S.free.map((f) => ({ ...f }));
    if (Object.keys(S.asm).length) data.asm = { ...S.asm };
    if (S.found !== "plinth") data.found = S.found;
    if (S.ins) data.ins = S.ins;
    if (S.lining !== "boards") data.lining = S.lining;
    if (S.deco) data.deco = JSON.parse(JSON.stringify(S.deco));
    if (S.plan.size) data.plan = [...S.plan].sort();
    S.ser = { ver: S.ver, data };
    return data;
  }
  // pieces of the old castle kit that no longer exist load as their ordinary equivalents
  const OLD_TYPE = { rampart: "wall", parapet: "rail", gate: "door", window3: "window" };
  const modern = (t) => OLD_TYPE[t] || t;
  // fresh: the data is being copied, so every piece in it gets a new id
  function fill(S, d, fresh) {
    S.floors = new Set(d.floors);
    S.walls = new Map(d.walls.map(([k, t]) => [k, modern(t)]));
    S.roofs = d.roofs.map((r) => ({ ...r }));
    S.segs = (d.segs || []).map((x) => Object.assign(x.slice(), { 4: modern(x[4]) }));
    S.stairs = (d.stairs || []).map((x) => ({ ...x }));
    S.pillars = (d.pillars || []).map((x) => x.slice());
    S.paths = (d.paths || []).map((x) => x.slice());
    S.decor = (d.decor || []).filter((x) => DECOR[x[2]]).map((x) => x.slice());
    S.wmat = new Map(Array.isArray(d.wmat) ? d.wmat : []);
    S.fmat = new Map(Array.isArray(d.fmat) ? d.fmat : []);
    S.polyRoofs = (d.polyRoofs || []).map((x) => x.slice());
    S.rings = (d.rings || []).map((r) => ({ ...r, sides: r.sides.map((t) => (t ? modern(t) : t)), roof: r.roof === "crenel" ? "cone" : r.roof }));
    S.free = (d.free || []).filter((f) => OP.openingType(f.typeId)).map((f) => ({ ...f, id: fresh ? null : f.id }));
    const ids = d.ids || {};
    S.wid = new Map(ids.walls || []);
    S.oid = new Map(ids.open || []);
    S.fid = new Map(ids.floors || []);
    S.pids = (ids.polys || []).map((x) => x.slice());
    S.asm = d.asm ? { ...d.asm } : {};
    S.fresh = !!fresh;
    S.found = d.found || "plinth";
    S.ins = d.ins || null;
    S.lining = d.lining === undefined ? "boards" : d.lining;
    S.deco = d.deco ? JSON.parse(JSON.stringify(d.deco)) : null;
    // a copy is a new plan: unbuilt where plans start unbuilt, built otherwise
    S.plan = new Set(fresh ? [] : d.plan || []);
    S.known = fresh ? new Set() : null;
    S.sitePlanned = fresh ? B.cmode : [...S.plan].some((id) => id.endsWith(".site"));
    return S;
  }
  function snapshot() {
    return { wood: W.wood, structs: B.structs.map(serial), fx: fxSerial() };
  }
  // put back an undo step
  function restoreSnap(snap) {
    for (const S of [...B.structs]) disposeStruct(S);
    for (const d of snap.structs) fill(newStruct(d), d);
    // storeys look at each other for stairwells, so build once all are in place
    for (const S of B.structs) rebuild(S);
    fxRestore(snap.fx);
    W.wood = snap.wood;
    G.markStockDirty();
    B.version++;
    selCheck();
  }
  function pushUndo() {
    B.undo.push(snapshot());
    B.undo.length > UNDO_DEPTH && B.undo.shift();
    B.redo.length = 0;
  }
  // ground-level sample points of everything in a structure (local)
  function localSamples(S) {
    const out = [];
    if (!S) return out;
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
      if (S.po || S.sitePlanned) continue;
      const smp = localSamples(S).map(([a, b]) => toWorld(S, a, b));
      if (!S.level) cutTerrain(S, smp, !!S.lift);
      else if (S.level < 0) cutTerrain(S, smp, true);
    }
    for (const S of list) rebuild(S);
  }
  /* ---------- saving: buildings are kept with the world seed ---------- */
  // serialize() gives every building as plain JSON and restore() puts such data back exactly, piece ids
  // included, so the world save can carry the buildings. Until it does, build mode keeps its own copy.
  const SAVE = "world-engine-build:1:",
    FORMAT = "homestead-buildings";
  function serialize() {
    const d = { format: FORMAT, v: 2, nextStruct: B.nextId, nextPiece: B.nextPid, structs: B.structs.map(serial) };
    if (FX.list.length) Object.assign(d, fxSerial());
    if (B.cmode) d.construction = true;
    return d;
  }
  // the highest piece number used anywhere in saved data
  function topPid(data) {
    let top = 0;
    const see = (id) => {
      if (typeof id === "string" && id[0] === "p") top = Math.max(top, pidNum(id));
    };
    for (const f of data.fixtures || []) see(f.id);
    for (const l of data.links || []) see(l.id);
    for (const d of data.structs) {
      for (const r of d.roofs || []) see(r.id);
      for (const r of d.rings || []) see(r.id);
      for (const r of d.stairs || []) see(r.id);
      for (const x of d.pillars || []) see(x[4]);
      for (const x of d.paths || []) see(x[6]);
      for (const x of d.decor || []) see(x[5]);
      for (const x of d.polyRoofs || []) see(x[3]);
      for (const x of d.free || []) see(x.id);
      for (const x of d.segs || []) (see(x[6]), see(x[7]));
      const ids = d.ids || {};
      for (const x of ids.walls || []) see(x[1]);
      for (const x of ids.open || []) see(x[1]);
      for (const x of ids.floors || []) see(x[1]);
      for (const x of ids.polys || []) see(x[2]);
    }
    return top;
  }
  // Replace every building with saved ones: what serialize() gave, or a version 1 save (which had no piece ids).
  function restoreAll(data) {
    if (!data || !Array.isArray(data.structs)) return false;
    for (const S of [...B.structs]) disposeStruct(S);
    B.undo.length = B.redo.length = 0;
    B.drag = null;
    B.nextId = 1;
    const made = data.structs.map((d) => fill(newStruct(d), d));
    fxRestore(data);
    B.nextId = Math.max(B.nextId, data.nextStruct || 1);
    B.nextPid = Math.max(topPid(data) + 1, data.nextPiece || 1);
    B.claim = new Set();
    try {
      settle(made);
    } finally {
      B.claim = null;
    }
    B.version++;
    selCheck();
    touchUi();
    return true;
  }
  function saveBuilds() {
    try {
      localStorage.setItem(SAVE + B.seed, JSON.stringify(serialize()));
    } catch {}
    if (G.saveGame) G.saveGame();
  }
  function loadBuilds() {
    try {
      // the world save carries the buildings; build mode's own copy is the fallback for older saves
      const fromWorld = G.savedBuilds && G.savedBuilds();
      const raw = localStorage.getItem(SAVE + B.seed);
      if ((!raw && !fromWorld) || B.structs.length) return;
      restoreAll(fromWorld && Array.isArray(fromWorld.structs) ? fromWorld : JSON.parse(raw));
    } catch {}
  }
  function ensureLoaded() {
    const seed = String(G.seed);
    if (seed === B.seed) return;
    B.seed = seed;
    loadBuilds();
    B.savedV = B.version;
    B.saveT = 0;
  }
  /* ---------- copy and stamp ---------- */
  function copyPick() {
    const h = B.hover;
    if (!h || h.F.isNew) return;
    copyFrom(h.F);
  }
  function copyFrom(S0) {
    const group = B.structs.filter((O) => sameGrid(O, S0) && !O.po),
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
    touchUi();
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
    pushUndo();
    const made = [];
    for (const it of c.items) {
      const S = newStruct({ ox: f.ox, oz: f.oz, yaw: f.yaw, y0: f.y0 + it.y0 - c.y0, level: it.level, hs: it.hs, lift: it.lift, po: it.po });
      fill(S, it, true);
      made.push(S);
    }
    settle(made);
    if (!B.free) {
      W.wood -= c.cost;
      G.markStockDirty();
    }
    G.burst(h.wx, f.y0 + 1, h.wz, 18, 0xcdb48a, 3.5, 3, 0.11, 0.7);
    touchUi();
  }
  function copyPreview(h) {
    B.key = "";
    B.op = null;
    gridGroup.visible = false;
    if (B.ov.dims.length || B.ov.snap) ((B.ov.dims.length = 0), (B.ov.snap = null), B.ovVer++);
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
        for (const q of [ga.main, ga.roof, ga.glow, ga.glass]) {
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
    ghostAdd.material.userData.hatch.value = why ? 1 : 0;
    label(why || "Click to place a copy" + (B.free ? "" : " \u00b7 " + c.cost + " wood"), !!why);
  }
  function undo() {
    if (!B.undo.length) return;
    B.redo.push(snapshot());
    restoreSnap(B.undo.pop());
    B.drag = null;
    B.move = null;
    B.key = "";
    touchUi();
  }
  function redo() {
    if (!B.redo.length) return;
    B.undo.push(snapshot());
    restoreSnap(B.redo.pop());
    B.drag = null;
    B.move = null;
    B.key = "";
    touchUi();
  }

  // Carry out an operation as one undo step. Entries that bring an id along (a piece being moved) keep it.
  function applyOp(op, noUndo) {
    if (!op || !op.valid) return null;
    noUndo || pushUndo();
    let S = op.F.isNew ? newStruct({ ox: op.F.ox, oz: op.F.oz, yaw: op.F.yaw, y0: op.y0, level: op.F.level || 0, hs: op.F.hs || B.hs, lift: op.F.lift || 0, po: op.addPaths.length > 0 || op.addDecor.length > 0, found: B.found, ins: B.ins, lining: B.lining, deco: B.deco, fresh: true }) : op.F;
    let refund = 0;
    if (op.delFree.length) S.free = S.free.filter((f) => !op.delFree.includes(f.id));
    if (op.moveFree) for (const f of S.free) if (f.d === op.moveFree.d && f.line === op.moveFree.from && f.pos >= op.moveFree.t0 - 1e-6 && f.pos <= op.moveFree.t1 + 1e-6) f.line = op.moveFree.to;
    for (const f of op.addFree) {
      const { out, ...rest } = f;
      S.free.push(rest);
    }
    for (const idx of [...op.delRoofs].sort((a, b) => b - a)) {
      const r = S.roofs.splice(idx, 1)[0];
      if (!op.replacing) refund += (r.i1 - r.i0 + 1) * (r.j1 - r.j0 + 1) * COST.roof;
    }
    for (const [i, j] of op.delFloors) (S.fmat.delete(ck(i, j)), S.floors.delete(ck(i, j)) && (refund += COST.floor));
    for (const idx of [...op.delPillars].sort((a, b) => b - a)) S.pillars.splice(idx, 1);
    for (const p of op.addPillars) S.pillars.push(p.slice());
    for (const [idx, mat, kind] of op.setPillars) ((S.pillars[idx][2] = mat), (S.pillars[idx][3] = kind));
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
      S.walls.set(ek(i, j, d), was === "railgate" ? "rail" : "wall");
    }
    // a door or window that changes kind is a new piece
    for (const [idx, ty] of op.setSegs) {
      if (S.segs[idx][4] !== ty) S.segs[idx][7] = null;
      S.segs[idx][4] = ty;
    }
    for (const [idx, mat] of op.setSegMats) S.segs[idx][5] = mat;
    for (const [ri, k, ty] of op.setSides) S.rings[ri].sides[k] = ty;
    for (const [ri, on] of op.ringRoofs) ((S.rings[ri].roof = on), on && (S.rings[ri].rmat = B.rmat));
    for (const idx of [...op.delSegs].sort((a, b) => b - a)) (S.segs.splice(idx, 1), (refund += COST.wall));
    for (const idx of [...op.delRings].sort((a, b) => b - a)) {
      const r = S.rings.splice(idx, 1)[0];
      refund += r.n * r.h * COST.wall + Math.round(Math.PI * r.r * r.r);
    }
    for (const pi of op.delPolyRoofs) S.polyRoofs = S.polyRoofs.filter((p) => !pip(S.polys[pi].pts, p[0], p[1]));
    for (const p of op.addPolyRoofs) S.polyRoofs.push([p[0], p[1], B.rmat, null]);
    for (const idx of [...op.delStairs].sort((a, b) => b - a)) S.stairs.splice(idx, 1);
    for (const st of op.addStairs) S.stairs.push({ ...st });
    for (const sg of op.addSegs) S.segs.push([sg[0], sg[1], sg[2], sg[3], sg[4], sg[5] || B.wmat, sg[6] || null, sg[7] || null]);
    for (const r of op.addRings) S.rings.push({ ...r, sides: r.sides.slice(), mat: r.mat || B.wmat, rmat: r.rmat || B.rmat, fmat: r.fmat || B.fmat });
    for (const [i, j, m] of op.addFloors) {
      const mat = m || B.fmat;
      S.floors.add(ck(i, j));
      mat !== "planks" ? S.fmat.set(ck(i, j), mat) : S.fmat.delete(ck(i, j));
    }
    for (const [i, j, m] of op.setFmats) m !== "planks" ? S.fmat.set(ck(i, j), m) : S.fmat.delete(ck(i, j));
    for (const [i, j, d, ty, m] of op.addWalls) {
      const mat = m || B.wmat;
      S.walls.set(ek(i, j, d), ty || op.style || "wall");
      mat !== "timber" ? S.wmat.set(ek(i, j, d), mat) : S.wmat.delete(ek(i, j, d));
    }
    for (const [i, j, d, m] of op.setMats) m !== "timber" ? S.wmat.set(ek(i, j, d), m) : S.wmat.delete(ek(i, j, d));
    for (const [i, j, d, ty] of op.setTypes) {
      if (S.walls.get(ek(i, j, d)) !== ty) S.oid.delete(ek(i, j, d));
      S.walls.set(ek(i, j, d), ty);
    }
    for (const r of op.addRoofs) {
      const nr = roofRec({ ...r, mat: r.mat || B.rmat });
      if (r.id) nr.id = r.id;
      S.roofs.push(nr);
    }
    // ids that travel with moved walls, openings and floors
    if (op.ids) {
      for (const [k, id] of op.ids.wid || []) S.wid.set(k, id);
      for (const [k, id] of op.ids.oid || []) S.oid.set(k, id);
      for (const [k, id] of op.ids.fid || []) S.fid.set(k, id);
    }
    if (!B.free) {
      W.wood += refund - (op.replacing ? 0 : op.cost);
      G.markStockDirty();
    }
    const samples = opSamples(op).map(([lx, lz]) => toWorld(S, lx, lz));
    if (S.sitePlanned) {
    } else if (!S.level) cutTerrain(S, samples, !!S.lift);
    else if (S.level < 0) cutTerrain(S, samples, true);
    if (isEmpty(S)) {
      disposeStruct(S);
      B.version++;
      S = null;
    } else {
      rebuild(S);
      if (!S.level && S.polys.length && !S.sitePlanned) {
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
    selCheck();
    touchUi();
    return S;
  }

  function touchUi() {
    B.uiVer++;
  }

  /* ---------- snapping ---------- */
  // Tools that work off the tile grid (walls at any angle, paths, pillars, round rooms, measuring) put their points
  // through here. In order: the end, middle or centre of something already built; a point on a wall; a round
  // angle from the start point, else the half-metre grid; and then lining up with a built corner, which slides
  // the point onto that corner's line and shows the line. Ctrl held turns the whole thing off (or on, if it is off).
  const SNAP = { x: 0, z: 0, type: "", g: [], ang: null, wx: 0, wz: 0 };
  const POINT_TOOL = { wall: 1, path: 1, pillar: 1, tower: 1, measure: 1 };
  const snapOn = () => B.snap !== (B.ctrl && !B.ctrlWheel);
  const SNAP_NAME = { end: "End", mid: "Middle", centre: "Centre", point: "Measured point", edge: "On wall", angle: "", guide: "Lined up", extend: "In line with wall", cross: "Where two walls would meet", grid: "", free: "" };
  // the points and wall lines of a structure that others can snap to, in world metres
  function snapData(S) {
    if (S.snapV === S.ver) return S.snapD;
    const pts = [],
      lines = [];
    const P = (lx, lz, kind) => {
      const [x, z] = toWorld(S, lx, lz);
      pts.push(x, z, kind);
    };
    const Ln = (ax, az, bx, bz) => {
      const a = toWorld(S, ax, az),
        b = toWorld(S, bx, bz);
      lines.push(a[0], a[1], b[0], b[1]);
      P(ax, az, 0);
      P(bx, bz, 0);
      P((ax + bx) / 2, (az + bz) / 2, 1);
    };
    for (const g of S.runs) g.d === 0 ? Ln(g.t0, g.line, g.t1, g.line) : Ln(g.line, g.t0, g.line, g.t1);
    for (const g of S.fruns) Ln(g.x0, g.z0, g.x1, g.z1);
    for (const r of S.rings) {
      P(r.cx, r.cz, 2);
      for (let k = 0; k < r.n; k++) {
        const v = ringVert(r, k);
        P(v[0], v[1], 0);
      }
    }
    for (const p of S.pillars) P(p[0], p[1], 2);
    S.snapV = S.ver;
    return (S.snapD = { pts, lines });
  }
  // a: the point the stroke started from (for angles); rel: the direction of the wall before it in a chain
  function snapPoint(F, rx, rz, a, rel) {
    const o = SNAP,
      c = Math.cos(F.yaw),
      s = Math.sin(F.yaw);
    o.x = rx;
    o.z = rz;
    o.type = "free";
    o.g.length = 0;
    o.ang = null;
    if (!snapOn()) return o;
    const wx = F.ox + rx * c + rz * s,
      wz = F.oz - rx * s + rz * c;
    const loc = (x, z) => {
      const dx = x - F.ox,
        dz = z - F.oz;
      o.x = tidy(dx * c - dz * s);
      o.z = tidy(dx * s + dz * c);
    };
    // 1. ends, middles and centres
    let bd = 0.42,
      bx = 0,
      bz = 0,
      bk = -1;
    const near = SNAP.near || (SNAP.near = []);
    near.length = 0;
    for (const S of B.structs) {
      if (S.po || S.cx === undefined || !S.group.visible || Math.hypot(wx - S.cx, wz - S.cz) > S.rad + 14) continue;
      near.push(S);
      const D = snapData(S).pts;
      for (let n = 0; n < D.length; n += 3) {
        const dd = Math.hypot(D[n] - wx, D[n + 1] - wz);
        if (dd < bd) ((bd = dd), (bx = D[n]), (bz = D[n + 1]), (bk = D[n + 2]));
      }
    }
    for (const m of B.meas)
      for (const q of [m.a, m.b]) {
        const dd = Math.hypot(q[0] - wx, q[2] - wz);
        if (dd < bd) ((bd = dd), (bx = q[0]), (bz = q[2]), (bk = 3));
      }
    if (bk >= 0) {
      loc(bx, bz);
      o.type = bk === 0 ? "end" : bk === 1 ? "mid" : bk === 2 ? "centre" : "point";
      return o;
    }
    // 2. on a wall: slide to the nearest half metre along it
    let ed = 0.24,
      hit = false;
    for (const S of near) {
      const D = snapData(S).lines;
      for (let n = 0; n < D.length; n += 4) {
        const ex = D[n + 2] - D[n],
          ez = D[n + 3] - D[n + 1],
          len = Math.hypot(ex, ez) || 1;
        let t = clamp(((wx - D[n]) * ex + (wz - D[n + 1]) * ez) / (len * len), 0, 1);
        const dd = Math.hypot(wx - D[n] - ex * t, wz - D[n + 1] - ez * t);
        if (dd >= ed) continue;
        const q = Math.round(t * len * 2) / 2;
        if (q >= 0 && q <= len) t = q / len;
        ed = dd;
        bx = D[n] + ex * t;
        bz = D[n + 1] + ez * t;
        hit = true;
      }
    }
    if (hit) {
      loc(bx, bz);
      o.type = "edge";
      return o;
    }
    // 3. a round angle from where the stroke began, or the grid
    let gx = Math.round(rx * 2) / 2,
      gz = Math.round(rz * 2) / 2;
    o.type = "grid";
    if (a) {
      const dx = rx - a.i,
        dz = rz - a.j,
        L = Math.hypot(dx, dz);
      if (L > 0.35) {
        const ang = Math.atan2(dz, dx),
          st = Math.PI / 12;
        let best = Math.round(ang / st) * st,
          dev = Math.abs(ang - best);
        if (rel !== null && rel !== undefined)
          for (let k = 0; k < 4; k++) {
            // square to, or in line with, the wall before
            const cand = rel + (k * Math.PI) / 2,
              df = Math.atan2(Math.sin(ang - cand), Math.cos(ang - cand));
            if (Math.abs(df) < dev) ((dev = Math.abs(df)), (best = ang - df));
          }
        if (dev < 0.075) {
          const Lq = Math.max(0.5, Math.round(L * 2) / 2),
            px = a.i + Math.cos(best) * Lq,
            pz = a.j + Math.sin(best) * Lq;
          if (Math.hypot(px - rx, pz - rz) <= Math.hypot(gx - rx, gz - rz) + 0.06) {
            if (Math.hypot(px - gx, pz - gz) > 1e-6) ((o.type = "angle"), (o.ang = best));
            gx = px;
            gz = pz;
          }
        }
      }
    }
    // 4. lined up with a built corner or centre
    let ax = null,
      az = null,
      adx = 1e9,
      adz = 1e9;
    for (const S of near) {
      const D = snapData(S).pts;
      for (let n = 0; n < D.length; n += 3) {
        if (D[n + 2] === 1) continue;
        const dx = D[n] - F.ox,
          dz = D[n + 1] - F.oz,
          px = dx * c - dz * s,
          pz = dx * s + dz * c,
          ex = Math.abs(px - gx),
          ez = Math.abs(pz - gz);
        if (ex < 0.22 && ez > 0.3 && ez < 24 && ez < adx) ((adx = ez), (ax = [px, pz]));
        if (ez < 0.22 && ex > 0.3 && ex < 24 && ex < adz) ((adz = ex), (az = [px, pz]));
      }
    }
    if (o.type === "angle") {
      // along a round angle: stop where it crosses the line
      const ux = Math.cos(o.ang),
        uz = Math.sin(o.ang);
      let k = null,
        ref = null;
      if (ax && Math.abs(ux) > 0.2) ((k = (ax[0] - a.i) / ux), (ref = ax));
      else if (az && Math.abs(uz) > 0.2) ((k = (az[1] - a.j) / uz), (ref = az));
      if (k !== null && k > 0.3 && Math.hypot(a.i + ux * k - gx, a.j + uz * k - gz) < 0.3) {
        gx = a.i + ux * k;
        gz = a.j + uz * k;
        o.g.push([ref[0], ref[1], gx, gz]);
      }
    } else {
      if (ax) gx = ax[0];
      if (az) gz = az[1];
      if (ax) o.g.push([ax[0], ax[1], gx, gz]);
      if (az) o.g.push([az[0], az[1], gx, gz]);
      if (ax || az) o.type = "guide";
    }
    // 5. in line with a wall that runs at an angle to this grid: carry its line on past its end. (Walls square to the
    // grid are already covered by lining up with their corners.) Two such lines near the cursor meet at a point.
    let e1 = null,
      e2 = null;
    for (const S of near) {
      const D = snapData(S).lines;
      for (let n = 0; n < D.length; n += 4) {
        const p0x = (D[n] - F.ox) * c - (D[n + 1] - F.oz) * s,
          p0z = (D[n] - F.ox) * s + (D[n + 1] - F.oz) * c,
          p1x = (D[n + 2] - F.ox) * c - (D[n + 3] - F.oz) * s,
          p1z = (D[n + 2] - F.ox) * s + (D[n + 3] - F.oz) * c,
          len = Math.hypot(p1x - p0x, p1z - p0z);
        if (len < 0.2) continue;
        const ux = (p1x - p0x) / len,
          uz = (p1z - p0z) / len;
        if (Math.abs(ux) < 0.02 || Math.abs(uz) < 0.02) continue;
        const t = (rx - p0x) * ux + (rz - p0z) * uz,
          dd = Math.abs((rx - p0x) * uz - (rz - p0z) * ux);
        if (dd > 0.25 || (t > -0.3 && t < len + 0.3) || t < -15 || t > len + 15) continue;
        const cand = { d: dd, ux, uz, ex: t < 0 ? p0x : p1x, ez: t < 0 ? p0z : p1z, k: t < 0 ? -t : t - len, sg: t < 0 ? -1 : 1 };
        if (!e1 || dd < e1.d) ((e2 = e1 && Math.abs(e1.ux * uz - e1.uz * ux) > 0.2 ? e1 : e2), (e1 = cand));
        else if ((!e2 || dd < e2.d) && Math.abs(e1.ux * uz - e1.uz * ux) > 0.2) e2 = cand;
      }
    }
    if (e1) {
      // where it ends: on the second wall's line, on the round angle or the lined-up corner already found, else a
      // round distance past the wall's end
      const meet = (qx, qz, vx, vz) => {
        const den = e1.ux * vz - e1.uz * vx;
        if (Math.abs(den) < 0.05) return null;
        const k = ((qx - e1.ex) * vz - (qz - e1.ez) * vx) / den;
        return [e1.ex + e1.ux * k, e1.ez + e1.uz * k];
      };
      let pt = null,
        kind = "extend";
      if (e2) ((pt = meet(e2.ex, e2.ez, e2.ux, e2.uz)), (kind = "cross"));
      else if (o.type === "angle") pt = meet(a.i, a.j, Math.cos(o.ang), Math.sin(o.ang));
      else if (ax) pt = meet(ax[0], ax[1], 0, 1);
      else if (az) pt = meet(az[0], az[1], 1, 0);
      if (!pt || Math.hypot(pt[0] - rx, pt[1] - rz) > 0.45) {
        const k = Math.max(0.5, Math.round(e1.k * 2) / 2) * e1.sg;
        pt = [e1.ex + e1.ux * k, e1.ez + e1.uz * k];
        kind = "extend";
        o.g.length = 0;
      }
      gx = pt[0];
      gz = pt[1];
      o.g.push([e1.ex, e1.ez, gx, gz]);
      if (kind === "cross") o.g.push([e2.ex, e2.ez, gx, gz]);
      o.type = kind;
      o.ang = null;
      o.x = gx;
      o.z = gz;
      return o;
    }
    o.x = tidy(gx);
    o.z = tidy(gz);
    return o;
  }

  /* ---------- picking ---------- */
  // What is under the cursor, found by where the mouse ray first meets a piece: walls as upright faces, floors as
  // their top, furniture, pillars and stairs as boxes. So you point at the wall you see, not at its foot.
  const ray = new T.Raycaster(),
    v2 = new T.Vector2();
  const RL = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 },
    HIT = { u: 0, y: 0 },
    WALLS_ONLY = { walls: true },
    ANY_PIECE = {};
  function setRay() {
    const rc = canvas.getBoundingClientRect();
    ray.setFromCamera(v2.set(((B.ptr.x - rc.left) / rc.width) * 2 - 1, -(((B.ptr.y - rc.top) / rc.height) * 2 - 1)), G.camera);
  }
  // the mouse ray in a structure's own metres, heights above its base
  function localRay(S) {
    const o = ray.ray.origin,
      d = ray.ray.direction,
      c = Math.cos(S.yaw),
      s = Math.sin(S.yaw),
      x = o.x - S.ox,
      z = o.z - S.oz;
    RL.ox = x * c - z * s;
    RL.oz = x * s + z * c;
    RL.oy = o.y - S.y0;
    RL.dx = d.x * c - d.z * s;
    RL.dz = d.x * s + d.z * c;
    RL.dy = d.y;
    return RL;
  }
  // A wall a door or window can go in, grid or angled, seen one way: positions run from t0 to t1 along it (a grid wall
  // counts from the grid origin, an angled one from its start), F0 is the frame at position 0, at(pos) the record's
  // placing fields at a position, and m lists what else stands in it (module pieces) as rough extents.
  function runAx(S, g) {
    if (g.free) return { g, free: true, t0: 0, t1: g.len, cls: g.cls, F0: { d: "f", gx: g.x0, gz: g.z0, ux: g.ux, uz: g.uz, pos: 0 }, at: (pos) => ({ d: "f", gx: g.x0, gz: g.z0, ux: g.ux, uz: g.uz, pos }) };
    return { g, free: false, t0: g.t0, t1: g.t1, cls: g.cls, F0: { d: g.d, line: g.line, pos: 0 }, at: (pos) => ({ d: g.d, line: g.line, pos }) };
  }
  // where the pointer meets the plane of a wall (frame F at position 0): u along it, y above the base
  function wallPtF(S, F) {
    setRay();
    const R = localRay(S),
      { V, O } = frameOf(F),
      den = R.dx * V[0] + R.dz * V[2];
    if (Math.abs(den) < 1e-9) return null;
    const t = ((O[0] - R.ox) * V[0] + (O[2] - R.oz) * V[2]) / den;
    if (t <= 0) return null;
    const x = R.ox + R.dx * t,
      z = R.oz + R.dz * t,
      { U } = frameOf(F);
    return { u: (x - O[0]) * U[0] + (z - O[2]) * U[2], y: R.oy + R.dy * t };
  }
  // where the pointer meets the plane of a grid wall line (d 0 runs along x): u along the line, y above the base
  function wallPt(S, d, line) {
    setRay();
    const R = localRay(S),
      den = d === 0 ? R.dz : R.dx;
    if (Math.abs(den) < 1e-9) return null;
    const t = (line - (d === 0 ? R.oz : R.ox)) / den;
    return t > 0 ? { u: d === 0 ? R.ox + R.dx * t : R.oz + R.dz * t, y: R.oy + R.dy * t } : null;
  }
  // how far along the ray it meets an upright face standing on the line a-b between two heights, or -1
  function hitWall(R, x0, z0, x1, z1, ya, yb) {
    const ex = x1 - x0,
      ez = z1 - z0,
      den = R.dx * ez - R.dz * ex;
    if (Math.abs(den) < 1e-9) return -1;
    const t = ((x0 - R.ox) * ez - (z0 - R.oz) * ex) / den;
    if (t <= 0) return -1;
    const u = ((R.ox + R.dx * t - x0) * ex + (R.oz + R.dz * t - z0) * ez) / (ex * ex + ez * ez),
      y = R.oy + R.dy * t;
    if (u < 0 || u > 1 || y < ya || y > yb) return -1;
    HIT.u = u;
    HIT.y = y;
    return t;
  }
  function hitBox(R, x0, y0, z0, x1, y1, z1) {
    let t0 = 0,
      t1 = 1e9;
    for (let k = 0; k < 3; k++) {
      const o = k === 0 ? R.ox : k === 1 ? R.oy : R.oz,
        d = k === 0 ? R.dx : k === 1 ? R.dy : R.dz,
        lo = k === 0 ? x0 : k === 1 ? y0 : z0,
        hi = k === 0 ? x1 : k === 1 ? y1 : z1;
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) return -1;
        continue;
      }
      const ta = (lo - o) / d,
        tb = (hi - o) / d;
      t0 = Math.max(t0, Math.min(ta, tb));
      t1 = Math.min(t1, Math.max(ta, tb));
      if (t0 > t1) return -1;
    }
    return t0;
  }
  const roofsShown = () => B.tool === "roof" || B.tool === "erase" || (B.tool === "equip" && fxRoofs()) || (B.tool === "select" && B.showRoofs);
  function pickAt(opt) {
    if (!pick.valid) return null;
    const wallsOnly = opt === WALLS_ONLY,
      roofs = !wallsOnly && roofsShown();
    let best = null,
      bt = 1e9;
    for (const S of B.structs) {
      if (S.cx === undefined || !S.group.visible || (S.po ? wallsOnly : S.level !== B.level)) continue;
      if (Math.hypot(pick.x - S.cx, pick.z - S.cz) > S.rad + 14) continue;
      const R = localRay(S),
        H = EAVE * S.hs;
      for (const g of S.runs) {
        const x = g.d === 0,
          t = x ? hitWall(R, g.t0, g.line, g.t1, g.line, -0.4, g.cls === "rail" ? 1.1 : H) : hitWall(R, g.line, g.t0, g.line, g.t1, -0.4, g.cls === "rail" ? 1.1 : H);
        if (t < 0 || t >= bt) continue;
        const e = g.m[Math.min(g.m.length - 1, Math.floor(HIT.u * g.m.length))];
        bt = t;
        best = { S, kind: "wall", i: e.i, j: e.j, d: e.d, type: e.type, id: g.id, oid: S.oid.get(e.k) || null, run: g, u: HIT.u, y: HIT.y };
      }
      for (const g of S.fruns) {
        const t = hitWall(R, g.x0, g.z0, g.x1, g.z1, -0.4, g.cls === "rail" ? 1.1 : H);
        if (t < 0 || t >= bt) continue;
        const along = HIT.u * g.len;
        let q = g.mods[g.mods.length - 1];
        for (const m of g.mods)
          if (along <= m.s + m.len) {
            q = m;
            break;
          }
        bt = t;
        best = { S, kind: "wall", free: true, idx: q.idx, type: q.type, id: g.id, oid: S.segs[q.idx][7] || null, run: g, u: HIT.u, y: HIT.y };
      }
      for (let ri = 0; ri < S.rings.length; ri++) {
        const r = S.rings[ri];
        for (let k = 0; k < r.n; k++) {
          if (!r.sides[k]) continue;
          const a = ringVert(r, k),
            b = ringVert(r, k + 1),
            t = hitWall(R, a[0], a[1], b[0], b[1], -0.4, r.h * H);
          if (t < 0 || t >= bt) continue;
          bt = t;
          best = { S, kind: "ring", ri, side: k, type: r.sides[k], id: r.id };
        }
      }
      if (wallsOnly) continue;
      if (roofs && R.dy < -1e-4) {
        // roofs are taken a little above the eave, as one slab over what they cover
        const t = (H + 0.8 - R.oy) / R.dy,
          x = R.ox + R.dx * t,
          z = R.oz + R.dz * t;
        if (t > 0 && t < bt) {
          const r = S.roofs.find((q) => x >= q.i0 - 0.4 && x <= q.i1 + 1.4 && z >= q.j0 - 0.4 && z <= q.j1 + 1.4),
            pi = r ? -1 : S.polys.findIndex((p) => p.roofed && pip(p.pts, x, z));
          if (r) ((bt = t), (best = { S, kind: "roof", r, id: r.id }));
          else if (pi >= 0) ((bt = t), (best = { S, kind: "polyroof", pi, id: S.polys[pi].roofId }));
        }
        for (let ri = 0; ri < S.rings.length; ri++) {
          const r = S.rings[ri];
          if (!r.roof) continue;
          const tr = (r.h * H + 0.8 - R.oy) / R.dy;
          if (tr > 0 && tr < bt && Math.hypot(R.ox + R.dx * tr - r.cx, R.oz + R.dz * tr - r.cz) < r.r + 0.5) ((bt = tr), (best = { S, kind: "ringroof", ri, id: r.id }));
        }
      }
      if (R.dy < -1e-4 && !S.po) {
        const t = (FLOOR_T - R.oy) / R.dy;
        if (t > 0 && t < bt) {
          const x = R.ox + R.dx * t,
            z = R.oz + R.dz * t,
            ci = Math.floor(x),
            cj = Math.floor(z),
            id = S.fid.get(ck(ci, cj));
          if (id) ((bt = t), (best = { S, kind: "floor", ci, cj, id }));
          else {
            const ri = ringAt(S, x, z),
              pi = ri >= 0 ? -1 : polyAt(S, x, z);
            if (ri >= 0) ((bt = t), (best = { S, kind: "ring", ri, id: S.rings[ri].id }));
            else if (pi >= 0) ((bt = t), (best = { S, kind: "floor", poly: pi, id: S.polys[pi].id }));
          }
        }
      }
      const sn = stairLen(S.hs);
      for (let idx = 0; idx < S.stairs.length; idx++) {
        const st = S.stairs[idx],
          [dx, dz] = DIRS[st.dir];
        for (let m = 0; m < sn; m++) {
          const t = hitBox(R, st.i + dx * m, 0, st.j + dz * m, st.i + dx * m + 1, FLOOR_T + ((m + 1) / sn) * H, st.j + dz * m + 1);
          if (t >= 0 && t < bt) ((bt = t), (best = { S, kind: "stair", idx, id: st.id }));
        }
      }
      for (let idx = 0; idx < S.pillars.length; idx++) {
        const p = S.pillars[idx],
          ch = p[3] === "chimney",
          w = ch ? 0.36 : 0.27,
          t = hitBox(R, p[0] - w, -0.3, p[1] - w, p[0] + w, ch ? stretchY(5.8, S.hs) : H, p[1] + w);
        if (t >= 0 && t < bt) ((bt = t), (best = { S, kind: "pillar", idx, id: p[4] }));
      }
      for (let idx = 0; idx < S.decor.length; idx++) {
        const it = S.decor[idx],
          y = decorY(S, it),
          bb = decorBox(decorGeo(it[2], it[4] || 0, H - y)),
          w = clamp(bb.r * 0.8, 0.28, 0.9),
          t = hitBox(R, it[0] - w, y, it[1] - w, it[0] + w, y + Math.max(0.2, bb.h), it[1] + w);
        if (t >= 0 && t < bt) ((bt = t), (best = { S, kind: "decor", idx, id: it[5] }));
      }
      if (S.paths.length) {
        // paths lie on the ground: take the one the ray lands on
        const [lx, lz] = toLocal(S, pick.x, pick.z),
          o = ray.ray.origin,
          t = Math.hypot(pick.x - o.x, pick.y - o.y, pick.z - o.z) - 0.02;
        for (let idx = 0; idx < S.paths.length && t < bt; idx++) {
          const p = S.paths[idx],
            dx = p[2] - p[0],
            dz = p[3] - p[1],
            tt = clamp(((lx - p[0]) * dx + (lz - p[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
          if (Math.hypot(lx - p[0] - dx * tt, lz - p[1] - dz * tt) < p[4] / 2 + 0.15) ((bt = t), (best = { S, kind: "path", idx, id: p[6] }));
        }
      }
    }
    return best;
  }
  // the piece a pick stands for: a door or window is its own piece, a tower side belongs to its tower
  const pickId = (pk) => (pk ? (pk.kind === "wall" && pk.oid ? pk.oid : pk.id) : null);

  /* ---------- selection ---------- */
  // Select is the home tool. What is selected is held as piece ids, so it survives any edit; everything done to a
  // selection (restyle, resize, move, copy, delete) is one undo step.
  const SEL = { refs: null, refV: -1, selV: -1, ver: -1, hov: null, meshes: [], hovMesh: null };
  B.selV = 0;
  B.sel = [];
  const hlOpts = { transparent: true, depthTest: false, depthWrite: false, fog: false, side: T.DoubleSide };
  const selMat = new T.MeshBasicMaterial({ color: 0xffc95e, opacity: 0.42, ...hlOpts }),
    hovMat = new T.MeshBasicMaterial({ color: 0xffffff, opacity: 0.2, ...hlOpts });
  const selGroup = new T.Group();
  selGroup.visible = false;
  G.scene.add(selGroup);
  // where each selectable piece lives; rebuilt when anything changes
  function refIndex() {
    if (SEL.refV === B.version && SEL.refs) return SEL.refs;
    const m = new Map();
    for (const S of B.structs) {
      for (const g of S.runs) m.set(g.id, { S, kind: "run", g, id: g.id });
      for (const g of S.fruns) m.set(g.id, { S, kind: "frun", g, id: g.id });
      for (const g of S.regs) m.set(g.id, { S, kind: "floor", g, id: g.id });
      for (const p of S.polys) {
        m.set(p.id, { S, kind: "poly", p, id: p.id });
        p.roofed && p.roofId && m.set(p.roofId, { S, kind: "polyroof", p, id: p.roofId });
      }
      for (const r of S.roofs) m.set(r.id, { S, kind: "roof", r, id: r.id });
      for (const r of S.rings) m.set(r.id, { S, kind: "ring", r, id: r.id });
      for (const st of S.stairs) m.set(st.id, { S, kind: "stair", st, id: st.id });
      for (const p of S.pillars) m.set(p[4], { S, kind: "pillar", p, id: p[4] });
      for (const p of S.paths) m.set(p[6], { S, kind: "path", p, id: p[6] });
      for (const it of S.decor) m.set(it[5], { S, kind: "decor", it, id: it[5] });
      for (const [k, id] of S.oid) m.set(id, { S, kind: "open", k, id });
      for (const sg of S.segs) sg[7] && m.set(sg[7], { S, kind: "sopen", sg, id: sg[7] });
    }
    SEL.refs = m;
    SEL.refV = B.version;
    return m;
  }
  const refOf = (id) => refIndex().get(id) || null;
  const selRefs = () => B.sel.map(refOf).filter(Boolean);
  // every piece of a structure that can be selected on its own
  const elemIds = (S) => [...S.runs.map((g) => g.id), ...S.fruns.map((g) => g.id), ...S.regs.map((g) => g.id), ...S.roofs.map((r) => r.id), ...S.rings.map((r) => r.id), ...S.stairs.map((s) => s.id), ...S.pillars.map((p) => p[4]), ...S.paths.map((p) => p[6]), ...S.decor.map((d) => d[5]), ...S.polys.filter((p) => p.roofed && p.roofId).map((p) => p.roofId)];
  const groupOf = (S) => (S.po ? [S] : B.structs.filter((O) => sameGrid(O, S) && !O.po));
  function selSet(ids) {
    B.sel = [...new Set(ids)].filter(refOf);
    if (!B.sel.some((id) => /roof/.test(refOf(id).kind))) B.showRoofs = B.showRoofs && !B.selRoofAuto;
    B.selV++;
    B.key = "";
    touchUi();
  }
  function selCheck() {
    if (!B.sel.length) return;
    const keep = B.sel.filter(refOf);
    if (keep.length !== B.sel.length) B.sel = keep;
    B.selV++;
  }
  // how to find a selected piece again after an edit that may merge or split it
  function anchorOf(q) {
    if (q.kind === "run") return ["w", q.S.id, q.g.m[0].k];
    if (q.kind === "frun") return ["s", q.S.id, q.S.segs[q.g.m[0]]];
    if (q.kind === "floor") return ["f", q.S.id, q.g.m[0]];
    if (q.kind === "open") return ["o", q.S.id, q.k];
    if (q.kind === "sopen") return ["so", q.S.id, q.sg];
    return ["id", 0, q.id];
  }
  function fromAnchor(a) {
    const S = B.structs.find((O) => O.id === a[1]);
    if (a[0] === "id") return a[2];
    if (!S) return null;
    if (a[0] === "w") return S.wid.get(a[2]);
    if (a[0] === "f") return S.fid.get(a[2]);
    if (a[0] === "o") return S.oid.get(a[2]);
    if (a[0] === "s") return S.segs.includes(a[2]) ? a[2][6] : null;
    return S.segs.includes(a[2]) ? a[2][7] : null;
  }
  // the selected parts of one structure as data buildGeo can draw
  function subset(S, refs) {
    const D = { floors: new Set(), walls: new Map(), wmat: new Map(), fmat: new Map(), roofs: [], segs: [], rings: [], stairs: [], pillars: [], paths: [], decor: [], polys: [], hs: S.hs, lift: S.lift, frame: S, base: S };
    for (const q of refs) {
      if (q.kind === "run") for (const e of q.g.m) (D.walls.set(e.k, e.type), D.wmat.set(e.k, q.g.mat));
      else if (q.kind === "frun") for (const n of q.g.m) D.segs.push(S.segs[n]);
      else if (q.kind === "floor") for (const c of q.g.m) (D.floors.add(c), D.fmat.set(c, q.g.mat));
      else if (q.kind === "poly") D.polys.push({ ...q.p, roofed: false });
      else if (q.kind === "polyroof") D.polys.push({ ...q.p, roofed: true });
      else if (q.kind === "roof") D.roofs.push(q.r);
      else if (q.kind === "ring") D.rings.push(q.r);
      else if (q.kind === "stair") D.stairs.push(q.st);
      else if (q.kind === "pillar") D.pillars.push(q.p);
      else if (q.kind === "path") D.paths.push(q.p);
      else if (q.kind === "decor") D.decor.push(q.it);
      else if (q.kind === "open") (D.walls.set(q.k, S.walls.get(q.k)), D.wmat.set(q.k, S.wmat.get(q.k) || "timber"));
      else if (q.kind === "sopen") D.segs.push(q.sg);
    }
    return D;
  }
  function geoMesh(D, S, mat) {
    const ga = buildGeo(D, S.depth || 0.5),
      g = ga.main;
    for (const q of [ga.roof, ga.glow, ga.glass]) (append(g.p, q.p), append(g.n, q.n), append(g.c, q.c));
    const m = new T.Mesh(g.build(), mat);
    m.position.set(S.ox, S.y0, S.oz);
    m.rotation.y = S.yaw;
    m.renderOrder = 22;
    m.frustumCulled = false;
    return m;
  }
  const byStruct = (refs) => {
    const by = new Map();
    for (const q of refs) (by.has(q.S) || by.set(q.S, []), by.get(q.S).push(q));
    return by;
  };
  const dropMesh = (m) => {
    m.parent && m.parent.remove(m);
    m.geometry.dispose();
  };
  // end handles of the one selected wall: [x, y, z, end]
  function handlesOf() {
    const out = [];
    if (B.tool !== "select" || B.sel.length !== 1 || B.move) return out;
    const q = refOf(B.sel[0]);
    if (!q || (q.kind !== "run" && q.kind !== "frun")) return out;
    const g = q.g,
      S = q.S,
      a = q.kind === "run" ? (g.d === 0 ? [g.t0, g.line] : [g.line, g.t0]) : [g.x0, g.z0],
      b = q.kind === "run" ? (g.d === 0 ? [g.t1, g.line] : [g.line, g.t1]) : [g.x1, g.z1];
    [a, b].forEach((p, n) => {
      const [x, z] = toWorld(S, p[0], p[1]);
      out.push([x, S.y0 + FLOOR_T, z, n]);
    });
    return out;
  }
  // redraw the highlight when the selection or the buildings changed
  function selDraw() {
    const show = B.on && B.tool === "select";
    selGroup.visible = show;
    if (!show) return;
    if (SEL.selV !== B.selV || SEL.ver !== B.version) {
      SEL.selV = B.selV;
      SEL.ver = B.version;
      for (const m of SEL.meshes) dropMesh(m);
      SEL.meshes = [];
      for (const [S, refs] of byStruct(selRefs())) {
        const m = geoMesh(subset(S, refs), S, selMat);
        selGroup.add(m);
        SEL.meshes.push(m);
      }
      B.ov.handles = handlesOf();
      B.ovVer++;
      SEL.hov = null;
    }
    const hid = B.move || B.marq ? null : B.hoverId || null;
    if (hid !== SEL.hov) {
      SEL.hov = hid;
      SEL.hovMesh && dropMesh(SEL.hovMesh);
      SEL.hovMesh = null;
      const q = hid && !B.sel.includes(hid) ? refOf(hid) : null;
      if (q) selGroup.add((SEL.hovMesh = geoMesh(subset(q.S, [q]), q.S, hovMat)));
    }
  }
  // change the selection's own data as one undo step, then find the pieces again
  function selEdit(fn) {
    const refs = selRefs();
    if (!refs.length) return;
    const anchors = refs.map(anchorOf),
      touched = new Set();
    pushUndo();
    for (const q of refs) fn(q) !== false && touched.add(q.S);
    for (const S of touched) for (const O of groupOf(S)) rebuild(O);
    B.sel = [...new Set(anchors.map(fromAnchor).filter(Boolean))];
    B.selV++;
    B.key = "";
    touchUi();
  }
  const setW = (S, k, m) => (m !== "timber" ? S.wmat.set(k, m) : S.wmat.delete(k));
  function selMaterial(cat, v) {
    selEdit((q) => {
      const S = q.S;
      if (cat === "wmat") {
        if (q.kind === "run") for (const e of q.g.m) setW(S, e.k, v);
        else if (q.kind === "frun") for (const n of q.g.m) S.segs[n][5] = v;
        else if (q.kind === "ring") q.r.mat = v;
        else if (q.kind === "pillar") q.p[2] = v;
        else return false;
      } else if (cat === "fmat") {
        if (q.kind === "floor") for (const c of q.g.m) v !== "planks" ? S.fmat.set(c, v) : S.fmat.delete(c);
        else if (q.kind === "poly") S.pids.forEach((m) => m[2] === q.p.id && (m[3] = v));
        else if (q.kind === "ring") q.r.fmat = v;
        else return false;
      } else if (cat === "rmat") {
        if (q.kind === "roof") q.r.mat = v;
        else if (q.kind === "polyroof") S.polyRoofs.forEach((m) => m[3] === q.id && (m[2] = v));
        else if (q.kind === "ring") q.r.rmat = v;
        else return false;
      } else if (cat === "pmat" && q.kind === "path") q.p[5] = v;
      else if (cat === "dcol" && q.kind === "decor") q.it[4] = v;
      else return false;
    });
  }
  // restyle whole walls: doors stay doors (as a gate in a fence), windows are walled up where they cannot stay
  function selStyle(v) {
    const cls = wallClass(v);
    const conv = (cur) => (isDoor(cur) ? (cls === "rail" ? "railgate" : cur === "railgate" ? "door" : cur) : isWin(cur) ? (cls === "wall" ? cur : baseType(cls)) : v);
    selEdit((q) => {
      if (q.kind === "run")
        for (const e of q.g.m) {
          const nt = conv(e.type);
          if (nt !== e.type) (q.S.oid.delete(e.k), q.S.walls.set(e.k, nt));
        }
      else if (q.kind === "frun")
        for (const n of q.g.m) {
          const sg = q.S.segs[n],
            nt = conv(sg[4]);
          if (nt !== sg[4]) ((sg[7] = null), (sg[4] = nt));
        }
      else return false;
    });
  }
  function selOpenType(v) {
    selEdit((q) => {
      if (q.kind === "open") (q.S.oid.delete(q.k), q.S.walls.set(q.k, v));
      else if (q.kind === "sopen") ((q.sg[4] = v), (q.sg[7] = null));
      else return false;
    });
  }
  // a free-angle wall drawn again between two points, keeping its doors and windows near where they were
  function redivide(S, g, x0, z0, x1, z1) {
    const k0 = g.mods.length,
      L = Math.hypot(x1 - x0, z1 - z0),
      k1 = Math.max(1, Math.round(L)),
      base = baseType(g.cls),
      types = Array(k1).fill(base),
      oids = Array(k1).fill(null),
      old = new Set(g.m.map((n) => S.segs[n]));
    g.mods.forEach((q, m) => {
      if (q.type === base) return;
      const m1 = Math.min(k1 - 1, Math.max(0, Math.round(((m + 0.5) / k0) * k1 - 0.5)));
      if (types[m1] === base) ((types[m1] = q.type), (oids[m1] = S.segs[q.idx][7]));
    });
    S.segs = S.segs.filter((sg) => !old.has(sg));
    const made = [];
    for (let m = 0; m < k1; m++) made.push([x0 + ((x1 - x0) * m) / k1, z0 + ((z1 - z0) * m) / k1, x0 + ((x1 - x0) * (m + 1)) / k1, z0 + ((z1 - z0) * (m + 1)) / k1, types[m], g.mat, g.id, oids[m]]);
    for (const sg of made) S.segs.push(sg);
    return made;
  }
  // lengthen or shorten a straight grid wall at one end: an op, so it previews and undoes like any other
  function endOp(S, g, which, m) {
    const op = blankOp(S),
      x = g.d === 0;
    op.ids = { wid: [], oid: [], fid: [] };
    op.move = true;
    if (m > 0)
      for (let s = 0; s < m; s++) {
        const t = which ? g.t1 + s : g.t0 - 1 - s,
          e = x ? [t, g.line, 0] : [g.line, t, 1],
          k = ek(e[0], e[1], e[2]);
        if (S.walls.has(k)) break;
        op.addWalls.push([e[0], e[1], e[2], baseType(g.cls), g.mat]);
        op.ids.wid.push([k, g.id]);
      }
    else
      for (let s = 0; s < Math.min(-m, g.m.length - 1); s++) {
        const e = which ? g.m[g.m.length - 1 - s] : g.m[s];
        op.delWalls.push([e.i, e.j, e.d]);
      }
    const len = g.m.length + op.addWalls.length - op.delWalls.length,
      mid = (g.t0 + g.t1) / 2;
    dim(op, x ? mid : g.line, x ? g.line : mid, fmtM(len));
    return finishOp(op);
  }
  // Push or pull a straight grid wall k metres across its line. Where it is the side of a floor, the floor, the
  // walls that meet its ends and a roof that ends on it all follow: the room grows or shrinks with its wall.
  function stretchOp(S, g, k) {
    const op = blankOp(S),
      x = g.d === 0,
      L0 = g.line,
      t0 = g.t0,
      t1 = g.t1;
    const tile = (t, row) => (x ? [t, row] : [row, t]),
      has = (t, row) => S.floors.has(ck(...tile(t, row))),
      along = (t, line) => (x ? [t, line, 0] : [line, t, 1]),
      across = (t, row) => (x ? [t, row, 1] : [row, t, 0]),
      wk = (e) => ek(e[0], e[1], e[2]);
    let lo = 0,
      hi = 0;
    for (let t = t0; t < t1; t++) (has(t, L0 - 1) && lo++, has(t, L0) && hi++);
    const out = lo && !hi ? 1 : hi && !lo ? -1 : 0,
      grow = Math.sign(k) === out;
    let n = Math.abs(k);
    if (out && !grow) {
      // it cannot be pulled in past the far side of its floor
      let depth = 0;
      for (let s = 0; s < 60; s++) {
        const row = out > 0 ? L0 - 1 - s : L0 + s;
        let any = false;
        for (let t = t0; t < t1 && !any; t++) any = has(t, row);
        if (!any) break;
        depth++;
      }
      n = Math.min(n, depth - 1);
    }
    const L1 = L0 + Math.sign(k) * n;
    op.ids = { wid: [], oid: [], fid: [] };
    op.move = true;
    if (!n) return finishOp(op);
    // the doors and windows in it come with it
    op.moveFree = { d: g.d, from: L0, to: L1, t0, t1 };
    for (const e of g.m) {
      const ne = along(e.t, L1);
      op.delWalls.push([e.i, e.j, e.d]);
      op.addWalls.push([ne[0], ne[1], ne[2], e.type, g.mat]);
      op.ids.wid.push([wk(ne), g.id]);
      S.oid.get(e.k) && op.ids.oid.push([wk(ne), S.oid.get(e.k)]);
    }
    const mid = (t0 + t1) / 2;
    dim(op, x ? mid : L1, x ? L1 : mid, (L1 > L0 === out > 0 || !out ? "+" : "−") + fmtM(n));
    if (!out) return finishOp(op);
    const inRow = out > 0 ? L0 - 1 : L0;
    const sideOf = (tEnd) => {
      const k2 = wk(across(tEnd, inRow));
      return S.walls.has(k2) ? [baseType(wallClass(S.walls.get(k2))), S.wmat.get(k2) || "timber"] : [baseType(g.cls), g.mat];
    };
    for (let s = 0; s < n; s++) {
      const row = grow ? (out > 0 ? L0 + s : L0 - 1 - s) : out > 0 ? L0 - 1 - s : L0 + s;
      for (let t = t0; t < t1; t++) {
        const c = tile(t, row);
        if (grow) has(t, row) || op.addFloors.push([c[0], c[1], S.fmat.get(ck(...tile(t, inRow))) || "planks"]);
        else has(t, row) && op.delFloors.push(c);
      }
      for (const tEnd of [t0, t1]) {
        const e = across(tEnd, row),
          beyond = has(tEnd === t0 ? t0 - 1 : t1, row);
        if (grow) {
          if (!S.walls.has(wk(e)) && !beyond) op.addWalls.push([e[0], e[1], e[2], ...sideOf(tEnd)]);
        } else if (S.walls.has(wk(e)) && !beyond) op.delWalls.push(e);
      }
      if (!grow) {
        // walls left inside the part that is cut away go with it
        for (let t = t0 + 1; t < t1; t++) S.walls.has(wk(across(t, row))) && op.delWalls.push(across(t, row));
        if (s < n - 1) {
          const Lm = out > 0 ? L0 - 1 - s : L0 + 1 + s;
          for (let t = t0; t < t1; t++) S.walls.has(wk(along(t, Lm))) && op.delWalls.push(along(t, Lm));
        }
      }
    }
    S.roofs.forEach((r, idx) => {
      const a0 = x ? r.i0 : r.j0,
        a1 = x ? r.i1 : r.j1,
        b0 = x ? r.j0 : r.i0,
        b1 = x ? r.j1 : r.i1;
      if (a0 < t0 || a1 > t1 - 1 || !(out > 0 ? b1 + 1 === L0 : b0 === L0)) return;
      const nb0 = out > 0 ? b0 : b0 + (L1 - L0),
        nb1 = out > 0 ? b1 + (L1 - L0) : b1;
      if (nb1 < nb0) return;
      op.delRoofs.push(idx);
      op.addRoofs.push({ ...r, i0: x ? r.i0 : nb0, i1: x ? r.i1 : nb1, j0: x ? nb0 : r.j0, j1: x ? nb1 : r.j1 });
      op.replacing = true;
    });
    const room = S.cellRoom.get(ck(...tile(t0, inRow)));
    if (room) {
      const w = (x ? room.i1 - room.i0 : room.j1 - room.j0) + 1,
        l = (x ? room.j1 - room.j0 : room.i1 - room.i0) + 1 + (grow ? n : -n);
      op.label = "Room " + w + " × " + l + " m · " + fmtA(w * l);
    }
    return finishOp(op);
  }
  const stretchable = (q) => q.kind === "run" && stretchOp(q.S, q.g, 1).addFloors.length + stretchOp(q.S, q.g, -1).addFloors.length > 0;
  // A structure's grid as it would stand after an op, without touching the structure: for edits made of two steps.
  function virtualAfter(S, op) {
    const V = { ...S, floors: new Set(S.floors), walls: new Map(S.walls), wmat: new Map(S.wmat), fmat: new Map(S.fmat), oid: new Map(S.oid), wid: new Map(S.wid), roofs: S.roofs.slice() };
    for (const idx of [...op.delRoofs].sort((a, b) => b - a)) V.roofs.splice(idx, 1);
    for (const [i, j] of op.delFloors) (V.floors.delete(ck(i, j)), V.fmat.delete(ck(i, j)));
    for (const [i, j, d] of op.delWalls) {
      const k = ek(i, j, d);
      (V.walls.delete(k), V.wmat.delete(k), V.oid.delete(k), V.wid.delete(k));
    }
    for (const [i, j, m] of op.addFloors) (V.floors.add(ck(i, j)), m && m !== "planks" ? V.fmat.set(ck(i, j), m) : V.fmat.delete(ck(i, j)));
    for (const [i, j, d, ty, m] of op.addWalls) {
      const k = ek(i, j, d);
      V.walls.set(k, ty || "wall");
      m && m !== "timber" ? V.wmat.set(k, m) : V.wmat.delete(k);
    }
    for (const r of op.addRoofs) V.roofs.push({ ...r });
    if (op.ids) {
      for (const [k, id] of op.ids.wid || []) V.wid.set(k, id);
      for (const [k, id] of op.ids.oid || []) V.oid.set(k, id);
    }
    return V;
  }
  // the one op that takes a structure's grid from where it stands to a virtual state
  function diffOp(S, V) {
    const op = blankOp(S),
      mat = (M, k) => M.wmat.get(k) || "timber",
      sameRoof = (p, q) => p.id === q.id && p.i0 === q.i0 && p.i1 === q.i1 && p.j0 === q.j0 && p.j1 === q.j1;
    op.ids = { wid: [], oid: [], fid: [] };
    op.move = true;
    for (const k of S.floors) V.floors.has(k) || op.delFloors.push(parse(k));
    for (const k of V.floors) S.floors.has(k) || op.addFloors.push([...parse(k), V.fmat.get(k) || "planks"]);
    for (const [k, ty] of S.walls) (V.walls.get(k) === ty && mat(V, k) === mat(S, k)) || op.delWalls.push(parse(k));
    for (const [k, ty] of V.walls) {
      if (S.walls.get(k) === ty && mat(V, k) === mat(S, k)) continue;
      op.addWalls.push([...parse(k), ty, mat(V, k)]);
      V.wid.get(k) && op.ids.wid.push([k, V.wid.get(k)]);
      V.oid.get(k) && op.ids.oid.push([k, V.oid.get(k)]);
    }
    S.roofs.forEach((r, idx) => V.roofs.some((q) => sameRoof(q, r)) || op.delRoofs.push(idx));
    for (const q of V.roofs) S.roofs.some((r) => sameRoof(q, r)) || op.addRoofs.push(q);
    op.replacing = op.delRoofs.length > 0;
    return op;
  }
  // Drag a room's corner both ways at once: the wall round the corner is pushed al metres and this wall ac metres.
  function cornerOp(S, g, corner, al, ac) {
    const op1 = stretchOp(S, corner, al);
    if (!op1.adds && !op1.dels) return stretchOp(S, g, ac);
    const V = virtualAfter(S, op1),
      mid = (g.t0 + g.t1) / 2,
      g2 = gridRuns(V).find((r) => r.d === g.d && r.line === g.line && r.t0 <= mid && r.t1 >= mid);
    if (!g2) return op1;
    g2.id = g.id;
    const op2 = stretchOp(V, g2, ac);
    if (!op2.adds && !op2.dels) return op1;
    const V2 = virtualAfter(V, op2),
      op = diffOp(S, V2),
      runs = gridRuns(V2),
      x = g.d === 0,
      line2 = g.line + (op2.addWalls.length ? Math.sign(ac) * Math.max(...op2.addWalls.filter((w) => w[2] === g.d).map((w) => Math.abs((x ? w[1] : w[0]) - g.line))) : 0),
      r1 = runs.find((r) => r.d === g.d && r.line === line2 && r.t0 <= mid && r.t1 >= mid);
    if (r1) dim(op, x ? (r1.t0 + r1.t1) / 2 : r1.line, x ? r1.line : (r1.t0 + r1.t1) / 2, fmtM(r1.t1 - r1.t0));
    for (const q of op2.dims) op.dims.push(q);
    op.label = op2.label || op1.label;
    return finishOp(op);
  }
  // the grid wall that turns the corner at one end of another
  function cornerRun(S, g, which) {
    const t = which ? g.t1 : g.t0;
    return S.runs.find((r) => r.d !== g.d && r.line === t && (r.t0 === g.line || r.t1 === g.line)) || null;
  }

  /* moving: B.move is a selection in the hand, a wall being pushed or pulled, or a wall end being dragged */
  const moveGroup = new T.Group();
  G.scene.add(moveGroup);
  function moveEnd() {
    for (const m of [...moveGroup.children]) dropMesh(m);
    B.move = null;
    B.key = "";
    B.selV++;
    touchUi();
  }
  // where the cursor is on the floor plane of a structure, in its own metres
  function onPlane(S) {
    const p = planeHit(S.y0 + FLOOR_T) || [pick.x, pick.z];
    return toLocal(S, p[0], p[1]);
  }
  function moveBegin(copy, hand, end) {
    const refs = selRefs();
    if (!refs.length) return;
    const lead = refs[0].S,
      one = refs.length === 1 ? refs[0] : null,
      M = { copy, hand, lead, sl: onPlane(lead), kind: "rigid", key: "" };
    if (end && one) {
      // a wall end: along the wall it lengthens it (or, at a corner, pushes the wall round the corner); a free-angle end goes anywhere
      M.kind = one.kind === "run" ? "gridEnd" : "freeEnd";
      M.q = one;
      M.end = end.n;
      const g = one.g;
      M.sl = one.kind === "run" ? (g.d === 0 ? [end.n ? g.t1 : g.t0, g.line] : [g.line, end.n ? g.t1 : g.t0]) : end.n ? [g.x1, g.z1] : [g.x0, g.z0];
    } else if (one && !copy && one.kind === "run" && stretchable(one)) ((M.kind = "stretch"), (M.q = one));
    else {
      const by = byStruct(refs);
      M.by = by;
      M.grid = refs.some((q) => q.kind === "run" || q.kind === "floor" || q.kind === "roof" || q.kind === "stair" || q.kind === "open");
      for (const [S, list] of by) moveGroup.add(geoMesh(subset(S, list), S, ghostAdd.material));
      if (hand) {
        // a copy in the hand hangs from the cursor by the middle of what was copied
        let x = 0,
          z = 0,
          n = 0;
        for (const id of B.sel) {
          const p = pieceById(id) || listPieces().find((q) => q.roof === id || q.tower === id);
          if (p) ((x += (p.a.x + p.b.x) / 2), (z += (p.a.z + p.b.z) / 2), n++);
        }
        if (n) {
          const c = toLocal(lead, x / n, z / n);
          M.sl = M.grid ? [Math.round(c[0]), Math.round(c[1])] : c;
        }
      }
    }
    B.move = M;
    B.key = "";
    touchUi();
  }
  // the op or ghost for where the cursor is now
  function moveUpdate() {
    const M = B.move,
      S = M.lead,
      cur = onPlane(S);
    let dx = cur[0] - M.sl[0],
      dz = cur[1] - M.sl[1];
    if (M.kind === "rigid") {
      const st = M.grid ? 1 : snapOn() ? 0.25 : 0;
      if (st) ((dx = Math.round(dx / st) * st), (dz = Math.round(dz / st) * st));
      const key = dx + "," + dz;
      if (key === M.key) return;
      M.key = key;
      M.d = [dx, dz];
      const c = Math.cos(S.yaw),
        s = Math.sin(S.yaw);
      M.w = [dx * c + dz * s, -dx * s + dz * c];
      moveGroup.position.set(M.w[0], 0, M.w[1]);
      const L = Math.hypot(dx, dz);
      B.label = L ? (M.copy ? "Copy " : "Move ") + fmtM(L) + (M.hand ? " · click to place" : "") : M.hand ? "Click to place a copy" : "";
      B.labelBad = false;
      B.ov.dims.length = 0;
      B.ovVer++;
      return;
    }
    const g = M.q.g,
      x = g.d === 0;
    let op = null,
      key = "";
    if (M.kind === "stretch") {
      const k = Math.round(x ? dz : dx);
      key = "s" + k;
      if (key !== M.key) op = k ? stretchOp(S, g, k) : null;
    } else if (M.kind === "gridEnd") {
      const al = Math.round(x ? dx : dz),
        ac = Math.round(x ? dz : dx),
        corner = cornerRun(S, g, M.end);
      key = "e" + al + "," + ac;
      // a corner goes both ways at once; an end that is not a corner follows the larger of the two movements
      if (key !== M.key) op = al && ac && corner ? cornerOp(S, g, corner, al, ac) : Math.abs(al) >= Math.abs(ac) ? (al ? (corner ? stretchOp(S, corner, al) : endOp(S, g, M.end, M.end ? al : -al)) : null) : stretchOp(S, g, ac);
    } else {
      // free-angle end: snap it like a wall being drawn from its other end
      const a = M.end ? { i: g.x0, j: g.z0 } : { i: g.x1, j: g.z1 },
        sp = snapPoint(S, cur[0], cur[1], a, null);
      key = "f" + sp.x + "," + sp.z + sp.type;
      if (key !== M.key) {
        op = blankOp(S);
        const L = Math.hypot(sp.x - a.i, sp.z - a.j),
          kk = Math.max(1, Math.round(L));
        for (let m = 0; m < kk; m++) op.addSegs.push([a.i + ((sp.x - a.i) * m) / kk, a.j + ((sp.z - a.j) * m) / kk, a.i + ((sp.x - a.i) * (m + 1)) / kk, a.j + ((sp.z - a.j) * (m + 1)) / kk, baseType(g.cls), g.mat]);
        dim(op, (a.i + sp.x) / 2, (a.j + sp.z) / 2, fmtM(L));
        op.snap = sp.type;
        op.marker = [sp.x, sp.z];
        for (const q of sp.g) op.guides.push(q);
        op.to = [sp.x, sp.z];
        op.move = true;
        finishOp(op);
        if (L < 0.5) op.valid = false;
      }
    }
    if (key === M.key) return;
    M.key = key;
    M.op = op;
    B.op = op;
    drawOp(op, S, false);
  }
  function translateIn(S, refs, di, dj, copy) {
    const walls = [],
      cells = [],
      gone = new Set(),
      open = [];
    for (const q of refs) {
      if (q.kind === "run") for (const e of q.g.m) walls.push([e.i, e.j, e.d, e.type, q.g.mat, q.id, S.oid.get(e.k)]);
      else if (q.kind === "floor") for (const c of q.g.m) cells.push([c, q.g.mat, q.id]);
      else if (q.kind === "open") open.push([q.k, S.walls.get(q.k), q.id]);
    }
    if (!copy) {
      for (const w of walls) {
        const k = ek(w[0], w[1], w[2]);
        (S.walls.delete(k), S.wmat.delete(k), S.wid.delete(k), S.oid.delete(k));
      }
      for (const c of cells) (S.floors.delete(c[0]), S.fmat.delete(c[0]), S.fid.delete(c[0]));
    }
    for (const w of walls) {
      const k = ek(w[0] + di, w[1] + dj, w[2]);
      S.walls.set(k, w[3]);
      setW(S, k, w[4]);
      if (!copy) (S.wid.set(k, w[5]), w[6] && S.oid.set(k, w[6]));
    }
    for (const c of cells) {
      const [i, j] = parse(c[0]),
        k = ck(i + di, j + dj);
      S.floors.add(k);
      c[1] !== "planks" ? S.fmat.set(k, c[1]) : S.fmat.delete(k);
      copy || S.fid.set(k, c[2]);
    }
    // a door or window on its own goes to the wall it lands on
    for (const o of open) {
      const [i, j, d] = parse(o[0]),
        k = ek(i + di, j + dj, d),
        cur = S.walls.get(k);
      if (!cur || isDoor(cur) || isWin(cur) || isLow(cur)) continue;
      if (!copy) (S.walls.set(o[0], "wall"), S.oid.delete(o[0]), S.oid.set(k, o[2]));
      S.walls.set(k, o[1]);
    }
    const moved = (arr, q, shift) => {
      if (copy) arr.push(shift(Array.isArray(q) ? q.slice() : { ...q, sides: q.sides && q.sides.slice() }, true));
      else shift(q, false);
    };
    for (const q of refs) {
      if (q.kind === "frun") {
        for (const sg of q.g.m.map((n) => S.segs[n])) moved(S.segs, sg, (v, fresh) => ((v[0] += di), (v[1] += dj), (v[2] += di), (v[3] += dj), fresh && (v[6] = v[7] = null), v));
        gone.add(q);
      } else if (q.kind === "roof") moved(S.roofs, q.r, (v, fresh) => ((v.i0 += di), (v.i1 += di), (v.j0 += dj), (v.j1 += dj), fresh && delete v.id, v));
      else if (q.kind === "ring") moved(S.rings, q.r, (v, fresh) => ((v.cx += di), (v.cz += dj), fresh && delete v.id, v));
      else if (q.kind === "stair") moved(S.stairs, q.st, (v, fresh) => ((v.i += di), (v.j += dj), fresh && delete v.id, v));
      else if (q.kind === "pillar") moved(S.pillars, q.p, (v, fresh) => ((v[0] += di), (v[1] += dj), fresh && (v[4] = null), v));
      else if (q.kind === "decor") moved(S.decor, q.it, (v, fresh) => ((v[0] += di), (v[1] += dj), fresh && (v[5] = null), v));
      else if (q.kind === "path") moved(S.paths, q.p, (v, fresh) => ((v[0] += di), (v[1] += dj), (v[2] += di), (v[3] += dj), fresh && (v[6] = null), v));
    }
    // a closed shape whose walls all moved keeps its floor and roof
    if (!copy && gone.size)
      for (const m of [...S.pids, ...S.polyRoofs]) {
        const p = S.polys.find((q) => pip(q.pts, m[0], m[1]));
        if (p && p.pts.every((v) => [...gone].some((q) => q.g.m.some((n) => Math.min(Math.hypot(S.segs[n][0] - di - v[0], S.segs[n][1] - dj - v[1]), Math.hypot(S.segs[n][2] - di - v[0], S.segs[n][3] - dj - v[1])) < 0.05)))) ((m[0] += di), (m[1] += dj));
      }
  }
  function moveCommit() {
    const M = B.move;
    if (!M) return;
    if (M.kind !== "rigid") {
      const op = M.op,
        S = M.lead,
        q = M.q,
        anchor = q.kind === "run" ? null : null;
      if (op && op.valid) {
        if (M.kind === "freeEnd") {
          pushUndo();
          const g = q.g,
            old = M.end ? [g.x1, g.z1] : [g.x0, g.z0],
            to = op.to;
          // walls that share this corner come with it
          for (const o of S.fruns) {
            if (o === g) continue;
            const e0 = Math.hypot(o.x0 - old[0], o.z0 - old[1]) < 0.03,
              e1 = Math.hypot(o.x1 - old[0], o.z1 - old[1]) < 0.03;
            if (e0 || e1) redivide(S, o, e0 ? to[0] : o.x0, e0 ? to[1] : o.z0, e1 ? to[0] : o.x1, e1 ? to[1] : o.z1);
          }
          M.end ? redivide(S, g, g.x0, g.z0, to[0], to[1]) : redivide(S, g, to[0], to[1], g.x1, g.z1);
          for (const O of groupOf(S)) rebuild(O);
        } else applyOp(op);
        settleFx();
      }
      selCheck();
      return moveEnd();
    }
    if (!M.d || (!M.d[0] && !M.d[1])) return M.hand ? undefined : moveEnd();
    pushUndo();
    const sel = new Set(B.sel),
      done = new Set(),
      lifted = [];
    for (const [S, refs] of M.by) {
      const grp = groupOf(S),
        whole = !M.copy && grp.every((O) => elemIds(O).every((id) => sel.has(id)));
      if (whole) {
        // a whole building moves as it stands, to wherever it is put, and sits on the ground there
        const dy = grp[0].po ? 0 : G.heightAt(grp[0].cx + M.w[0], grp[0].cz + M.w[1]) - G.heightAt(grp[0].cx, grp[0].cz);
        for (const O of grp) {
          if (done.has(O)) continue;
          done.add(O);
          O.ox += M.w[0];
          O.oz += M.w[1];
          O.y0 += dy;
          O.group.position.set(O.ox, O.y0, O.oz);
          lifted.push(O);
        }
        continue;
      }
      // other pieces move within their structure, on its own grid
      const c = Math.cos(S.yaw),
        s = Math.sin(S.yaw);
      let di = M.w[0] * c - M.w[1] * s,
        dj = M.w[0] * s + M.w[1] * c;
      if (refs.some((q) => q.kind === "run" || q.kind === "floor" || q.kind === "roof" || q.kind === "stair" || q.kind === "open")) ((di = Math.round(di)), (dj = Math.round(dj)));
      translateIn(S, refs, di, dj, M.copy);
      for (const O of groupOf(S)) done.has(O) || (done.add(O), lifted.push(O));
    }
    settle(lifted);
    B.version++;
    settleFx();
    selCheck();
    if (M.hand) {
      M.key = "";
      B.selV++;
      return touchUi();
    }
    moveEnd();
  }
  function selDelete() {
    const refs = selRefs();
    if (!refs.length) return;
    pushUndo();
    for (const [S, list] of byStruct(refs)) {
      const op = blankOp(S);
      for (const q of list) {
        if (q.kind === "run") for (const e of q.g.m) op.delWalls.push([e.i, e.j, e.d]);
        else if (q.kind === "frun") for (const n of q.g.m) op.delSegs.push(n);
        else if (q.kind === "floor") for (const c of q.g.m) op.delFloors.push(parse(c));
        else if (q.kind === "roof") op.delRoofs.push(S.roofs.indexOf(q.r));
        else if (q.kind === "polyroof") op.delPolyRoofs.push(S.polys.indexOf(q.p));
        else if (q.kind === "ring") op.delRings.push(S.rings.indexOf(q.r));
        else if (q.kind === "stair") op.delStairs.push(S.stairs.indexOf(q.st));
        else if (q.kind === "pillar") op.delPillars.push(S.pillars.indexOf(q.p));
        else if (q.kind === "path") op.delPaths.push(S.paths.indexOf(q.p));
        else if (q.kind === "decor") op.delDecor.push(S.decor.indexOf(q.it));
        else if (q.kind === "open") op.revert.push(parse(q.k));
        else if (q.kind === "sopen") op.setSegs.push([S.segs.indexOf(q.sg), baseType(wallClass(q.sg[4]))]);
      }
      // a door in a wall that is going anyway needs no separate step
      op.revert = op.revert.filter((r) => !op.delWalls.some((w) => w[0] === r[0] && w[1] === r[1] && w[2] === r[2]));
      applyOp(finishOp(op), true);
    }
    selSet([]);
  }
  function selBuilding() {
    const ids = [];
    for (const S of new Set(selRefs().map((q) => q.S))) for (const O of groupOf(S)) ids.push(...elemIds(O));
    selSet(ids);
  }
  // typed values from the inspector
  function selField(name, v) {
    const q = selRefs()[0];
    if (!q || !isFinite(v)) return;
    const S = q.S;
    if (name === "len" && q.kind === "run") {
      const m = clamp(Math.round(v), 1, 80) - q.g.m.length;
      if (!m) return touchUi();
      const op = endOp(S, q.g, 1, m),
        k0 = q.g.m[0].k;
      applyOp(op);
      selSet([S.wid.get(k0)]);
    } else if (name === "len" && q.kind === "frun") {
      const g = q.g,
        L = clamp(v, 0.5, 80);
      pushUndo();
      redivide(S, g, g.x0, g.z0, g.x0 + g.ux * L, g.z0 + g.uz * L);
      for (const O of groupOf(S)) rebuild(O);
      selSet([g.id]);
    } else if (name === "hs") setStorey(S, clamp(v / EAVE, 0.7, 2.5));
    else if (name === "x" || name === "z") {
      const n = name === "x" ? 0 : 1;
      selEdit((r) => {
        if (r.kind === "decor") r.it[n] = v;
        else if (r.kind === "pillar") r.p[n] = v;
        else if (r.kind === "ring") r.r[n ? "cz" : "cx"] = v;
        else return false;
      });
    } else if (name === "width" && q.kind === "ring") selEdit((r) => ((r.r.r = clamp(v / 2, 1.5, 9)), (r.r.n = clamp(Math.round((Math.PI * 2 * r.r.r) / 1.05 / 2) * 2, 8, 32)), (r.r.rot = Math.PI / r.r.n), (r.r.sides = Array(r.r.n).fill("wall"))));
    touchUi();
  }
  // ceiling height of a storey; the storeys above ride up or down with it
  function setStorey(S, hs) {
    if (Math.abs(hs - S.hs) < 1e-6) return;
    pushUndo();
    const delta = EAVE * (hs - S.hs);
    S.hs = hs;
    for (const O of B.structs)
      if (O !== S && sameGrid(O, S) && O.level > S.level && S.level >= 0) {
        O.y0 += delta;
        O.group.position.y = O.y0;
      }
    for (const O of B.structs) sameGrid(O, S) && rebuild(O);
    B.key = "";
    touchUi();
  }
  // take a piece's style and material in hand, with the tool that builds it
  function pickUp(id) {
    const q = refOf(id);
    if (!q) return false;
    const S = q.S;
    if (q.kind === "run" || q.kind === "frun") {
      const types = q.kind === "run" ? q.g.m.map((e) => e.type) : q.g.mods.map((m) => m.type),
        plain = types.find((t) => !isDoor(t) && !isWin(t)) || "wall";
      B.style = STYLE_NAME[plain] ? plain : "wall";
      B.wmat = q.g.mat;
      B.tool = "wall";
    } else if (q.kind === "open" || q.kind === "sopen") {
      const ty = q.kind === "open" ? S.walls.get(q.k) : q.sg[4];
      if (isWin(ty)) ((B.wstyle = ty), (B.tool = "window"));
      else ((B.dstyle = DOOR_NAME[ty] ? ty : "door"), (B.tool = "door"));
    } else if (q.kind === "floor" || q.kind === "poly") ((B.fmat = q.kind === "floor" ? q.g.mat : q.p.fmat), (B.tool = "floor"));
    else if (q.kind === "roof") {
      const r = q.r;
      takeRoof(r);
      B.rmat = r.mat || "thatch";
      B.tool = "roof";
    } else if (q.kind === "polyroof") ((B.rmat = q.p.rmat || "thatch"), (B.tool = "roof"));
    else if (q.kind === "ring") ((B.wmat = q.r.mat || "timber"), (B.fmat = q.r.fmat || "planks"), (B.levels = q.r.h), q.r.roof && ((B.tshape = q.r.roof === true ? "cone" : q.r.roof), (B.rmat = q.r.rmat || "thatch")), (B.tool = "tower"));
    else if (q.kind === "pillar") ((B.wmat = q.p[2] || "timber"), (B.pkind = q.p[3] || "pillar"), (B.tool = "pillar"));
    else if (q.kind === "path") ((B.pwidth = q.p[4]), (B.pmat = q.p[5] || "cobble"), (B.tool = "path"));
    else if (q.kind === "decor") ((B.dkind = q.it[2]), (B.drot = q.it[3] || 0), (B.dcol = q.it[4] || 0), (B.tool = "decor"));
    else if (q.kind === "stair") ((B.stairDir = q.st.dir), (B.tool = "stairs"));
    B.tapMode = "";
    B.drag = null;
    B.key = "";
    touchUi();
    return true;
  }
  // everything whose middle falls inside a rectangle on the screen
  function marqueeIds(x0, y0, x1, y1) {
    const ids = [],
      lo = [Math.min(x0, x1), Math.min(y0, y1)],
      hi = [Math.max(x0, x1), Math.max(y0, y1)],
      seen = new Set();
    for (const p of listPieces()) {
      const id = p.roof || p.tower || p.id,
        q = refOf(id);
      if (!q || seen.has(id) || q.S.level !== B.level || (/roof/.test(q.kind) && !roofsShown()) || q.kind === "open" || q.kind === "sopen") continue;
      const s = toScreen((p.a.x + p.b.x) / 2, p.y0, (p.a.z + p.b.z) / 2);
      if (s[0] >= lo[0] && s[0] <= hi[0] && s[1] >= lo[1] && s[1] <= hi[1]) (seen.add(id), ids.push(id));
    }
    return ids;
  }
  const _v3 = new T.Vector3();
  const SCR = [0, 0];
  function toScreen(x, y, z) {
    const rc = canvas.getBoundingClientRect();
    _v3.set(x, y, z).project(G.camera);
    SCR[0] = rc.left + (_v3.x * 0.5 + 0.5) * rc.width;
    SCR[1] = rc.top + (-_v3.y * 0.5 + 0.5) * rc.height;
    return SCR;
  }

  /* ---------- measuring ---------- */
  // Click two points to keep a measurement on the ground until it is dismissed. Its ends can be snapped to.
  const measMesh = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ color: 0x9fe3ff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, fog: false, side: T.DoubleSide }));
  measMesh.renderOrder = 23;
  measMesh.frustumCulled = false;
  measMesh.visible = false;
  G.scene.add(measMesh);
  function measPoint(h) {
    const [x, z] = toWorld(h.F, h.sx, h.sz);
    return [x, h.F.isNew || h.F.po ? G.heightAt(x, z) : h.F.y0 + FLOOR_T, z, h.F.yaw];
  }
  function measText(a, b) {
    const dx = b[0] - a[0],
      dz = b[2] - a[2],
      L = Math.hypot(dx, dz),
      rise = b[1] - a[1],
      c = Math.cos(a[3] || 0),
      s = Math.sin(a[3] || 0),
      an = (Math.atan2(Math.abs(dx * s + dz * c), Math.abs(dx * c - dz * s)) * 180) / Math.PI;
    return { len: L, rise, direct: Math.hypot(L, rise), angle: an, text: fmtM(L) + (Math.abs(rise) > 0.02 ? " · " + (rise > 0 ? "up " : "down ") + fmtM(Math.abs(rise)) : " · level") + " · " + Math.round(an) + "°" };
  }
  function measDraw(live) {
    const g = new Geo(),
      w = Math.max(0.03, G.cam.dist * 0.0022),
      lines = B.meas.map((m) => [m.a, m.b]);
    live && lines.push(live);
    for (const [a, b] of lines) {
      const dx = b[0] - a[0],
        dz = b[2] - a[2],
        L = Math.hypot(dx, dz) || 1,
        nx = (-dz / L) * w,
        nz = (dx / L) * w,
        ya = a[1] + 0.06,
        yb = b[1] + 0.06;
      g.tri([a[0] - nx, ya, a[2] - nz], [a[0] + nx, ya, a[2] + nz], [b[0] + nx, yb, b[2] + nz], [0, 1, 0], [1, 1, 1]);
      g.tri([a[0] - nx, ya, a[2] - nz], [b[0] + nx, yb, b[2] + nz], [b[0] - nx, yb, b[2] - nz], [0, 1, 0], [1, 1, 1]);
      for (const p of [a, b]) g.abox(p[0] - w * 2.5, p[1] + 0.02, p[2] - w * 2.5, p[0] + w * 2.5, p[1] + 0.1, p[2] + w * 2.5, [1, 1, 1]);
    }
    setGeo(measMesh, g);
    measMesh.visible = B.on && lines.length > 0;
    B.ov.meas = lines.map(([a, b], n) => ({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 + 0.1, z: (a[2] + b[2]) / 2, text: measText(a, b).text, n: n < B.meas.length ? n : -1 }));
    B.ovVer++;
  }
  function measClick() {
    const h = B.hover;
    if (!h) return;
    const p = measPoint(h);
    if (!B.measA) B.measA = p;
    else {
      if (Math.hypot(p[0] - B.measA[0], p[2] - B.measA[2]) > 0.05) (B.meas.push({ a: B.measA, b: p }), B.meas.length > 8 && B.meas.shift());
      B.measA = null;
    }
    B.key = "";
    measDraw(null);
    touchUi();
  }
  function measClear(n) {
    if (n === undefined || n < 0) B.meas.length = 0;
    else B.meas.splice(n, 1);
    B.measA = null;
    B.key = "";
    measDraw(null);
    touchUi();
  }

  /* ---------- hover and preview ---------- */
  // what the interface draws over the view: live dimensions, the snap marker, wall handles, measurements, the marquee
  B.ov = { dims: [], snap: null, handles: [], meas: [], marq: null, ports: [] };
  B.label = "";
  B.labelBad = false;
  B.gap = 2;
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
    B.hoverId = null;
    if (!B.ptr.inside) {
      B.hover = null;
      return;
    }
    setRay();
    terrainHit();
    if (!c.valid) {
      B.hover = null;
      return;
    }
    const tool = B.tool;
    let F = null;
    if (B.drag) F = B.drag.F;
    else {
      let best = 1e9,
        bt = 1e9;
      const along = (y) => (ray.ray.direction.y < -1e-4 ? (y - ray.ray.origin.y) / ray.ray.direction.y : 1e9);
      for (const S of B.structs) {
        // paths and loose furniture live in their own structures, which only those tools draw into
        if (S.level !== B.level || (S.po ? tool !== "path" && tool !== "decor" : tool === "path")) continue;
        const hit = (S.po ? null : planeHit(S.y0 + FLOOR_T)) || [c.x, c.z];
        const [lx, lz] = toLocal(S, hit[0], hit[1]);
        const dx = Math.max(S.b.i0 - lx, 0, lx - S.b.i1),
          dz = Math.max(S.b.j0 - lz, 0, lz - S.b.j1),
          dist = Math.hypot(dx, dz),
          t = S.po ? 1e9 : along(S.y0 + FLOOR_T);
        // of two the cursor is right over, the one the ray meets first is the one you are pointing at
        if (dist < (tool === "decor" && !S.po ? 0.6 : 3.5) && (dist < best - 1e-6 || (Math.abs(dist - best) <= 1e-6 && (S.po ? false : F && F.po ? true : t < bt)))) {
          best = dist;
          bt = t;
          F = S;
        }
      }
      if (B.level !== 0 && tool !== "path" && tool !== "copy" && tool !== "decor" && tool !== "select" && tool !== "measure") {
        // A storey that does not exist yet starts over (or a cellar under) the building the cursor is on. That may be
        // a different building from the nearest one that already has this storey, standing at a different height.
        const below = B.level > 0 ? B.level - 1 : 0;
        let FN = null,
          bn = F ? best : 1e9,
          tn = F ? bt : 1e9;
        for (const S of B.structs) {
          if (S.level !== below || S.po) continue;
          const y0 = B.level > 0 ? S.y0 + EAVE * S.hs : S.y0 - EAVE * B.hs;
          if (B.structs.some((O) => O.level === B.level && !O.po && sameGrid(O, S) && Math.abs(O.y0 - y0) < 0.3)) continue;
          const hit = planeHit(y0 + FLOOR_T);
          if (!hit) continue;
          const [lx, lz] = toLocal(S, hit[0], hit[1]),
            dist = Math.hypot(Math.max(S.b.i0 - lx, 0, lx - S.b.i1), Math.max(S.b.j0 - lz, 0, lz - S.b.j1)),
            t = along(y0 + FLOOR_T);
          if (dist < 3 && (dist < bn - 1e-6 || (Math.abs(dist - bn) <= 1e-6 && t < tn))) {
            bn = dist;
            tn = t;
            FN = { ox: S.ox, oz: S.oz, yaw: S.yaw, y0, isNew: true, level: B.level, hs: B.hs };
          }
        }
        if (FN) F = FN;
        if (!F) {
          B.hover = null;
          return;
        }
      }
      if (!F) {
        const p = B.pending;
        if (!snapOn()) {
          // free placement: the new grid starts exactly under the cursor and faces the way the view does
          p.yaw = ((G.cam.yaw % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
          p.ox = c.x;
          p.oz = c.z;
          p.free = true;
        } else {
          const yaw = snapYaw(G.cam.yaw);
          if (p.free || p.yaw !== yaw || Math.hypot(c.x - p.ox, c.z - p.oz) > 60) {
            p.free = false;
            p.yaw = yaw;
            p.ox = Math.round(c.x);
            p.oz = Math.round(c.z);
            // a new building beside one that faces the same way shares its grid, so the two line up
            let near = null,
              nd = 40;
            for (const S of B.structs) {
              if (S.po || S.cx === undefined || Math.abs(((S.yaw - yaw + Math.PI / 4) % (Math.PI / 2)) - Math.PI / 4) > 1e-6) continue;
              const dd = Math.hypot(S.cx - c.x, S.cz - c.z) - S.rad;
              if (dd < nd) ((nd = dd), (near = S));
            }
            if (near) {
              const [lx, lz] = toLocal(near, c.x, c.z);
              [p.ox, p.oz] = toWorld(near, Math.round(lx), Math.round(lz));
              p.yaw = near.yaw;
            }
          }
        }
        p.y0 = c.y + B.lift + FOUNDATIONS[B.found].drop - 0.05;
        p.lift = B.lift;
        F = p;
      }
    }
    // existing buildings and drags in progress work on a flat plane, like the grid that is drawn
    const hit = (tool === "path" || F.po ? null : F.isNew ? (B.drag || F.level ? planeHit(F.y0) : null) : planeHit(F.y0 + FLOOR_T)) || [c.x, c.z];
    const [lx, lz] = toLocal(F, hit[0], hit[1]);
    const h = (B.hover = { F, lx, lz, wx: c.x, wz: c.z, wy: c.y, sx: lx, sz: lz, snap: "", guides: null });
    if (!F.isNew && F.roofs && F.roofs.length) {
      const rh = planeHit(F.y0 + EAVE * F.hs + 0.8);
      if (rh) [h.rlx, h.rlz] = toLocal(F, rh[0], rh[1]);
    }
    if (POINT_TOOL[tool]) {
      const d = B.drag,
        a = d && d.a && tool !== "tower" ? d.a : tool === "measure" && B.measA ? null : null,
        sp = snapPoint(F, lx, lz, a, d ? d.rel : null);
      h.sx = sp.x;
      h.sz = sp.z;
      h.snap = sp.type;
      h.ang = sp.ang;
      h.guides = sp.g.length ? sp.g.map((q) => q.slice()) : null;
    }
    if (tool === "select" || B.tapMode) B.hoverId = pickId(pickAt(ANY_PIECE));
  }

  function setGeo(mesh, geo) {
    mesh.geometry.dispose();
    mesh.geometry = geo.build();
  }
  // the ghost of an operation: what it adds (cream, or hatched red where it cannot go), what it takes away (red),
  // guide lines, the snap marker and the live dimensions
  function drawOp(op, F, d) {
    B.ghostIs = "op";
    if (!op) {
      ghostGroup.visible = gridGroup.visible = false;
      B.ov.dims.length = 0;
      B.ov.snap = null;
      B.ovVer++;
      label("");
      return;
    }
    ghostGroup.position.set(F.ox, F.y0, F.oz);
    ghostGroup.rotation.y = F.yaw;
    gridGroup.position.copy(ghostGroup.position);
    gridGroup.rotation.y = F.yaw;
    const depth = F.isNew ? 1.2 : F.depth || 0.5,
      Sx = F.isNew ? null : F;
    const A = { floors: new Set(op.addFloors.map(([i, j]) => ck(i, j))), walls: new Map(), wmat: new Map(), fmat: new Map(), roofs: op.addRoofs, segs: op.addSegs.slice(), rings: op.addRings.slice(), stairs: op.addStairs, pillars: op.addPillars.slice(), hs: F.hs || B.hs, paths: op.addPaths, frame: F, lift: F.lift || 0, decor: op.addDecor, base: Sx };
    A.free = op.addFree.map((f) => ({ ...f, built: true, ghost: true }));
    A.polys = op.addPolyRoofs.length && Sx ? [{ ...Sx.polys[polyAt(Sx, op.addPolyRoofs[0][0], op.addPolyRoofs[0][1])], roofed: true }] : [];
    const sideSeg = (ri, k, ty) => [...ringVert(Sx.rings[ri], k), ...ringVert(Sx.rings[ri], k + 1), ty];
    if (Sx) for (const [idx, ty] of op.setSegs) A.segs.push([...Sx.segs[idx].slice(0, 4), ty]);
    if (Sx) for (const [idx] of op.setSegMats) A.segs.push(Sx.segs[idx].slice(0, 5));
    for (const [ri, k, ty] of op.setSides) ty && A.segs.push(sideSeg(ri, k, ty));
    for (const [ri, on] of op.ringRoofs) on && A.rings.push({ ...Sx.rings[ri], sides: [], roof: on, floor: false });
    for (const [i, j, dd, ty] of op.addWalls) A.walls.set(ek(i, j, dd), ty || op.style || "wall");
    for (const [i, j, dd, ty] of op.setTypes) A.walls.set(ek(i, j, dd), ty);
    for (const [i, j, dd] of op.setMats) A.walls.has(ek(i, j, dd)) || A.walls.set(ek(i, j, dd), Sx.walls.get(ek(i, j, dd)));
    for (const [i, j] of op.setFmats) A.floors.add(ck(i, j));
    for (const [idx, m, kind] of op.setPillars) A.pillars.push([Sx.pillars[idx][0], Sx.pillars[idx][1], m, kind]);
    const ga = buildGeo(A, depth),
      merged = ga.main;
    for (const q of [ga.roof, ga.glow, ga.glass]) (append(merged.p, q.p), append(merged.n, q.n), append(merged.c, q.c));
    if (op.hline) merged.abox(op.hline.d === 0 ? op.hline.a : op.hline.line - 0.1, op.hline.y - 0.012, op.hline.d === 0 ? op.hline.line - 0.1 : op.hline.a, op.hline.d === 0 ? op.hline.b : op.hline.line + 0.1, op.hline.y + 0.012, op.hline.d === 0 ? op.hline.line + 0.1 : op.hline.b, [1, 1, 1]);
    if (op.marker) merged.abox(op.marker[0] - 0.14, 0, op.marker[1] - 0.14, op.marker[0] + 0.14, d ? EAVE : 0.5, op.marker[1] + 0.14, [1, 1, 1]);
    if (d && d.a && (B.tool === "room" || B.tool === "wall")) merged.abox(d.a.i - 0.14, 0, d.a.j - 0.14, d.a.i + 0.14, EAVE, d.a.j + 0.14, [1, 1, 1]);
    setGeo(ghostAdd, merged);
    const bad = !(op.valid || op.idle);
    ghostAdd.material.color.setHex(bad ? 0xe0563f : 0xffe2a0);
    ghostAdd.material.userData.hatch.value = bad ? 1 : 0;
    const S = Sx;
    const Dl = { floors: new Set(op.delFloors.map(([i, j]) => ck(i, j))), walls: new Map(), roofs: S && !op.replacing ? op.delRoofs.map((i) => S.roofs[i]) : [] };
    if (!op.move) for (const [i, j, dd] of op.delWalls.concat(op.revert)) Dl.walls.set(ek(i, j, dd), (S && S.walls.get(ek(i, j, dd))) || "wall");
    else Dl.floors = new Set(op.delFloors.map(([i, j]) => ck(i, j)));
    Dl.segs = S ? op.delSegs.map((idx) => S.segs[idx]) : [];
    Dl.rings = S ? op.delRings.map((idx) => S.rings[idx]) : [];
    Dl.stairs = S ? op.delStairs.map((idx) => S.stairs[idx]) : [];
    Dl.pillars = S ? op.delPillars.map((idx) => S.pillars[idx]) : [];
    Dl.paths = S ? op.delPaths.map((idx) => S.paths[idx]) : [];
    Dl.decor = S ? op.delDecor.map((idx) => S.decor[idx]) : [];
    Dl.free = S ? S.free.filter((f) => op.delFree.includes(f.id)).map((f) => ({ ...f, out: f.out, built: true, ghost: true })) : [];
    Dl.base = S;
    Dl.frame = F;
    Dl.hs = S ? S.hs : 1;
    Dl.polys = op.replacing ? [] : op.delPolyRoofs.map((pi) => S.polys[pi]);
    for (const [ri, k, ty] of op.setSides) ty || Dl.segs.push(sideSeg(ri, k, S.rings[ri].sides[k]));
    for (const [ri, on] of op.ringRoofs) on || Dl.rings.push({ ...S.rings[ri], sides: [], roof: true, floor: false });
    const gd = buildGeo(Dl, depth);
    for (const q of [gd.roof, gd.glass]) (append(gd.main.p, q.p), append(gd.main.n, q.n), append(gd.main.c, q.c));
    setGeo(ghostDel, gd.main);
    // guide lines: from the snapping, and for rooms where the corner lines up with one already built
    const gg = new Geo(),
      gw = Math.max(0.02, G.cam.dist * 0.0013),
      tip = op.end || (op.marker ? { i: op.marker[0], j: op.marker[1] } : null);
    const line = (x0, z0, x1, z1) => {
      const dx = x1 - x0,
        dz = z1 - z0,
        L = Math.hypot(dx, dz) || 1;
      gg.obox([(x0 + x1) / 2, FLOOR_T + 0.05, (z0 + z1) / 2], [dx / 2, 0, dz / 2], [0, 0.01, 0], [(-dz / L) * gw, 0, (dx / L) * gw], [1, 1, 1]);
    };
    for (const q of op.guides) line(q[0], q[1], q[2], q[3]);
    if (tip && B.tool === "room" && snapOn()) {
      let gi = null,
        gj = null;
      for (const [ci, cj] of gridCorners(F)) {
        if (ci === tip.i && cj !== tip.j && (!gi || Math.abs(cj - tip.j) < Math.abs(gi[1] - tip.j))) gi = [ci, cj];
        if (cj === tip.j && ci !== tip.i && (!gj || Math.abs(ci - tip.i) < Math.abs(gj[0] - tip.i))) gj = [ci, cj];
      }
      gi && line(gi[0], gi[1], tip.i, tip.j);
      gj && line(gj[0], gj[1], tip.i, tip.j);
      if (gi || gj) op.snap = "guide";
    }
    setGeo(guideMesh, gg);
    // the snap marker and live dimensions, for the interface to draw
    const ov = B.ov,
      up = F.y0 + (F.isNew ? 0.1 : FLOOR_T + 0.05);
    ov.snap = null;
    if (tip && op.snap && SNAP_NAME[op.snap] !== undefined && op.snap !== "free") {
      const [x, z] = toWorld(F, tip.i, tip.j);
      ov.snap = { x, y: up, z, type: op.snap, text: op.snap === "angle" ? Math.round((Math.atan2(Math.abs(Math.sin(B.hover ? B.hover.ang || 0 : 0)), Math.abs(Math.cos(B.hover ? B.hover.ang || 0 : 0))) * 180) / Math.PI) + "°" : SNAP_NAME[op.snap] };
    }
    ov.dims.length = 0;
    for (const q of op.dims) {
      const [x, z] = toWorld(F, q.lx, q.lz);
      ov.dims.push({ x, y: q.y !== undefined ? F.y0 + q.y : up, z, text: q.text, field: q.field, val: q.val, unit: q.unit });
    }
    if (!(d && d.fgrab)) ov.dims.push(...selDims());
    ov.fieldB = op.fieldB || null;
    B.ovVer++;
    let text = op.label || "";
    if (!op.valid && op.reason) text = op.reason;
    else if (op.note) text = op.note;
    else if (op.adds && !B.free && op.cost && !op.move) text += (text ? " · " : "") + op.cost + " wood";
    else if (op.dels && !op.adds) text = text || "Remove";
    label(text, !op.valid && !!op.reason);
    ghostGroup.visible = true;
  }
  function updatePreview() {
    const h = B.hover;
    if (B.move) {
      gridGroup.visible = false;
      if (h) moveUpdate();
      ghostGroup.visible = B.move.kind !== "rigid" && !!B.move.op;
      return;
    }
    if (!h || B.tool === "select") {
      ghostGroup.visible = gridGroup.visible = false;
      if (B.op || B.ov.dims.length || B.ov.snap) ((B.ov.dims.length = 0), (B.ov.snap = null), B.ovVer++);
      if (freeTool() && B.fsel) ((B.ov.dims = selDims()), B.ovVer++);
      label(!h && B.level !== 0 && B.ptr.inside && B.tool !== "select" ? (B.level > 0 ? "Upper storeys go above the storey below" : "Cellars go under an existing building") : "");
      B.op = null;
      B.key = "x";
      if (B.tool === "select") hint();
      return;
    }
    if (B.tool === "copy") return copyPreview(h);
    if (B.tool === "equip") return fxPreview();
    const F = h.F,
      d = B.drag,
      ty = B.typed;
    const fine = B.tool === "door" || B.tool === "window" || B.tool === "opening" || B.tool === "erase" || B.tool === "decor";
    const key = [B.tool, F.isNew ? "n" + F.ox + "," + F.oz + "," + F.yaw : F.id, d ? d.a.i + "," + d.a.j : "-", POINT_TOOL[B.tool] ? h.sx + "," + h.sz + h.snap : fine ? Math.round(h.lx * 6) + "," + Math.round(h.lz * 6) : Math.round(h.lx * 2) + "," + Math.round(h.lz * 2), fine && h.rlx !== undefined ? Math.round(h.rlx * 2) + "," + Math.round(h.rlz * 2) : "", B.alt, B.levels, B.level, B.hs, B.lift, B.style, B.wstyle, B.dstyle, B.otype, B.osize, B.osill, B.oflip, B.fsel, B.ctrl, B.rsh, B.rturn, B.pitch12, B.eave, B.rake, B.gutters, B.rcolor, B.tshape, B.pwidth, B.pmat, B.dkind, B.drot, B.dcol, B.pkind, B.wmat, B.fmat, B.rmat, B.stairDir, B.free, B.version, W.wood, ty.a, ty.b, B.gap, snapOn(), B.tapMode, B.measA ? 1 : 0].join("|");
    if (key !== B.key) {
      B.key = key;
      if (B.tool === "measure" || B.tapMode) {
        // measuring and the eyedropper only point: a marker where the click will land
        const op = blankOp(F);
        op.idle = true;
        op.snap = h.snap;
        op.marker = B.tapMode ? null : [h.sx, h.sz];
        if (h.guides) for (const g of h.guides) op.guides.push(g);
        B.op = op;
        drawOp(op, F, null);
        if (B.tool === "measure" && !B.tapMode) measDraw(B.measA ? [B.measA, measPoint(h)] : null);
        label(B.tapMode === "pick" ? (B.hoverId ? "Take this in hand" : "") : B.tapMode === "paint" ? (B.hoverId ? "Paint" : "") : "");
      } else drawOp((B.op = computeOp()), F, d);
      hint();
    }
    gridGroup.userData.lines.position.set(Math.round(h.lx), FLOOR_T + 0.03, Math.round(h.lz));
    gridGroup.visible = B.tool !== "measure" && !B.tapMode;
  }
  function label(text, bad) {
    if (B.label === text && B.labelBad === !!bad) return;
    B.label = text;
    B.labelBad = !!bad;
    B.ovVer++;
  }
  const TOUCH = () => document.body.classList.contains("touch");
  // one sentence per tool, verb first, at most 70 characters; the longer explanation is the tool's tip (TOOLS)
  const HINTS = {
    select: "Click a piece to select it, or drag it to move it.",
    room: "Drag out a room. Type a number for an exact size.",
    tower: "Drag out from the middle of a round room.",
    wall: "Drag a wall, or click point to point. Drawing over a wall restyles it.",
    floor: "Drag out floor. Laying it over a floor changes its surface.",
    roof: "Click a room to roof it, or drag a rectangle. Enter roofs it all.",
    door: "Click a wall to hang the door. Drag it to slide.",
    window: "Click a wall to place the window. Drag an edge to resize.",
    stairs: "Drag from the foot of the stairs the way they climb.",
    pillar: "Click to stand a pillar, or drag for an evenly spaced row.",
    path: "Drag a path over the ground, or click point to point.",
    decor: "Pick a piece, then click to place it. Wall pieces snap to walls.",
    measure: "Click two points to measure between them.",
    erase: "Click a piece to remove it, or drag a box to clear an area.",
    equip: "Pick equipment, then click to place it. Drag port to port to wire.",
    copy: "Click where you want a copy.",
  };
  // the room under the cursor, for the Roof and Select trays: what it measures and whether it is closed in
  function roomFacts() {
    const h = B.hover,
      on = h && !h.F.isNew && (B.tool === "roof" || (B.tool === "select" && !B.sel.length)),
      room = on ? h.F.cellRoom.get(ck(Math.floor(h.lx), Math.floor(h.lz))) : null,
      key = room && room.cells.length > 1 ? h.F.id + "|" + room.i0 + "," + room.j0 + "," + room.i1 + "," + room.j1 + "|" + B.version : "";
    if (key === B.roomKey) return;
    B.roomKey = key;
    let f = null;
    if (key) {
      const w = room.i1 - room.i0 + 1,
        l = room.j1 - room.j0 + 1;
      f = { title: "Room " + w + " × " + l + " m", text: fmtA(room.cells.length) + " · " + (room.enclosed ? (room.roofed ? "walled and roofed" : "walled in, no roof yet") : plural(room.gaps.length, "open edge") + " marked in amber") };
    }
    B.roomFacts = f;
    B.uiVer++;
  }
  function hint() {
    let text = HINTS[B.tool] || "";
    if ((B.tool === "window" && B.wleg) || (B.tool === "door" && B.dleg)) text = B.tool === "door" ? "Click a wall to hang a rustic door. Drag along the wall for a row." : "Click a wall for a rustic window. Drag along it for a row.";
    else if (B.fsel && (B.tool === "door" || B.tool === "window")) text = B.tool === "door" ? "Drag an edge to resize, or the middle to slide it. F flips it." : "Drag an edge to resize, or the middle to move it. Delete removes it.";
    if (B.ores) text = "Drag to resize. Snaps every 5 cm and to store sizes; Ctrl is free.";
    const d = B.drag;
    if (B.tapMode === "pick") text = "Click any piece to take its style and material in hand.";
    else if (B.tapMode === "paint") text = "Click or drag across pieces to give them the material in hand.";
    else if (B.move) text = B.move.hand ? "Click to place a copy. Esc puts it down." : "Release to place. Esc cancels.";
    else if (B.tool === "measure" && B.measA) text = "Click the second point.";
    else if (d && d.mode === "click") text = "Click to place. Type a number for an exact size. Esc stops.";
    else if (d && (B.tool === "wall" || B.tool === "room" || B.tool === "floor" || B.tool === "path" || B.tool === "tower")) text = "Release to place. Type a number for an exact size. Esc cancels.";
    else if (d) text = "Release to place. Esc cancels.";
    else if (B.tool === "copy" && !B.clipb) text = "Click a building to pick it up.";
    else if (B.tool === "select" && B.sel.length) text = B.sel.length === 1 ? "Drag it to move it, or change it below. Delete removes it." : "Drag to move them together, or change them below. Delete removes them.";
    // room facts no longer replace the hint: they are an info group in the Roof and Select trays
    roomFacts();
    if (B.flash && performance.now() < B.flash.until) text = B.flash.text;
    if (TOUCH()) text = text.replace(/\bClick\b/g, "Tap").replace(/\bclick\b/g, "tap").replace(/ Esc (stops|cancels|puts it down)\./, "").replace(/ Type a number for an exact size\./, " Tap the size to type it.").replace(" Delete removes it.", "").replace(" Delete removes them.", "").replace(" F flips it.", "");
    if (text !== B.hintText) ((B.hintText = text), B.uiVer++);
  }

  /* ---------- input ---------- */
  function anchorFor(h) {
    if (POINT_TOOL[B.tool]) return { i: h.sx, j: h.sz };
    return B.tool === "room" ? { i: Math.round(h.lx), j: Math.round(h.lz) } : { i: Math.floor(h.lx), j: Math.floor(h.lz) };
  }
  function freeze(F) {
    return F.isNew ? { ...F } : F;
  }
  // a soft settle where something was just placed: the ghost flashes and sinks into place
  const settleMesh = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0, depthWrite: false, fog: false, side: T.DoubleSide }));
  settleMesh.visible = false;
  settleMesh.frustumCulled = false;
  settleMesh.renderOrder = 19;
  G.scene.add(settleMesh);
  let settleT = 0;
  function settleFx() {
    if (!ghostAdd.geometry.attributes.position || B.ghostIs !== "op") return;
    settleMesh.geometry.dispose();
    settleMesh.geometry = ghostAdd.geometry.clone();
    settleMesh.position.copy(ghostGroup.position);
    settleMesh.rotation.y = ghostGroup.rotation.y;
    settleMesh.visible = true;
    settleT = 0.26;
  }
  function settleTick(dt) {
    if (settleT <= 0) return;
    settleT -= dt;
    const k = Math.max(0, settleT / 0.26);
    settleMesh.material.opacity = 0.5 * k * k;
    settleMesh.position.y = ghostGroup.position.y + 0.18 * k * k;
    if (settleT <= 0) settleMesh.visible = false;
  }
  function typedClear() {
    if (B.typed.a === null && B.typed.b === null) return;
    B.typed.a = B.typed.b = null;
    B.typedV = (B.typedV || 0) + 1;
    B.key = "";
  }
  function commit() {
    B.key = "";
    updateHover();
    const op = computeOp();
    const d = B.drag;
    B.drag = null;
    if (op && op.shut) {
      const S = op.shut.S,
        f = S.free.find((x) => x.id === op.shut.id);
      if (!f) return;
      pushUndo();
      f.look = { ...(f.look || {}), shutters: op.shut.v };
      S.ver++;
      rebuild(S);
      saveBuilds();
      touchUi();
      return;
    }
    if (op && !op.valid && op.pick) {
      // nothing to build here because the piece is already there: select it instead
      typedClear();
      setTool("select");
      if (/roof/.test((refOf(op.pick) || {}).kind || "")) B.showRoofs = B.selRoofAuto = true;
      return selSet([op.pick]);
    }
    if (!op || !op.valid) {
      B.key = "";
      touchUi();
      return;
    }
    const end = op.end,
      a = d && d.a;
    drawOp(op, op.F, d);
    const S = applyOp(op);
    settleFx();
    typedClear();
    // point to point: the next wall or stretch of path starts where this one ended
    if (S && d && d.mode === "click" && (B.tool === "wall" || B.tool === "path") && end) B.drag = { F: S, a: end, t: performance.now(), mode: "click", rel: Math.atan2(end.j - a.j, end.i - a.i) };
    hint();
    touchUi();
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
    B.ptr.touch = touch;
    aimDot.hidden = !(touch && B.on && inside);
    aimDot.style.left = B.ptr.x + "px";
    aimDot.style.top = B.ptr.y + "px";
  }
  const pair = () => {
    const [p, q] = [...fingers.values()];
    return { d: Math.hypot(q.x - p.x, q.y - p.y) || 1, ang: Math.atan2(q.y - p.y, q.x - p.x), my: (p.y + q.y) / 2 };
  };
  // the tools that act on a single click
  const tapTool = () => B.tool === "equip" || B.tool === "copy" || B.tool === "measure" || (B.drag && B.drag.mode === "click") || (B.move && B.move.hand) || (B.tool === "path" && B.alt) || B.tool === "decor";
  function tapAct() {
    if (B.move && B.move.hand) return moveCommit();
    if (B.tapMode === "pick") {
      updateHover();
      return void (B.hoverId && pickUp(B.hoverId));
    }
    if (B.tool === "measure") return measClick();
    if (B.tool === "equip") return fxClick();
    if (B.tool === "copy") return void (B.clipb ? stamp() : copyPick());
    commit();
  }
  // which end handle of the selected wall the pointer is on
  function handleAt() {
    for (const p of B.ov.handles) {
      const s = toScreen(p[0], p[1], p[2]);
      if (Math.hypot(s[0] - B.ptr.x, s[1] - B.ptr.y) < (B.ptr.touch ? 22 : 13)) return { n: p[3], k: typeof p[3] === "string" ? p[3] : null };
    }
    return null;
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
    if (B.ores) return void (B.ctrl = e.ctrlKey || e.metaKey, resizeMove());
    if (B.on && e.buttons & 2) {
      G.cam.yaw -= e.movementX * 0.006;
      G.cam.pitch = clamp(G.cam.pitch + e.movementY * 0.004, 0.5, 1.35);
      B.camT = 0;
    }
    const pr = B.press;
    if (B.on && pr && e.buttons & 1) {
      if (!pr.go && Math.hypot(e.clientX - pr.x, e.clientY - pr.y) > 6) {
        // a press that turns into a drag: an end handle, the piece under it, or a marquee over open ground
        pr.go = true;
        updateHover();
        if (pr.hd) moveBegin(false, false, pr.hd);
        else if (pr.id) {
          if (!B.sel.includes(pr.id)) selSet(pr.shift ? [...B.sel, pr.id] : [pr.id]);
          setRay();
          ray.ray.origin.copy(pr.o);
          ray.ray.direction.copy(pr.dir);
          moveBegin(false, false, null);
        } else B.marq = B.ov.marq = { x0: pr.x, y0: B.ptr.y + pr.y - e.clientY, x1: B.ptr.x, y1: B.ptr.y };
      }
      if (B.marq) ((B.marq.x1 = B.ptr.x), (B.marq.y1 = B.ptr.y), B.ovVer++);
    }
    if (B.on && B.painting && e.buttons & 1) (updateHover(), paint(B.painting));
  });
  canvas.addEventListener("pointerleave", (e) => e.pointerType !== "touch" && ((B.ptr.inside = false), (B.key = "")));
  canvas.addEventListener("pointerdown", (e) => {
    const touch = e.pointerType === "touch";
    if (touch && B.on) {
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size >= 2) {
        // a second finger: drop whatever was being drawn and move the view instead
        if (!gest) gest = { ...pair(), dist: G.cam.dist, yaw: G.cam.yaw, pitch: G.cam.pitch };
        B.aim = false;
        if (B.drag && B.drag.mode === "drag") B.drag = null;
        if (B.move && !B.move.hand) moveEnd();
        B.press = B.marq = B.ov.marq = null;
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
    B.ctrl = e.ctrlKey || e.metaKey;
    // an edge handle of the selected door or window: resize it
    if (freeTool() && B.fsel) {
      const hd = handleAt();
      if (hd && hd.k && resizeBegin(hd.k)) {
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch (err) {}
        return;
      }
    }
    updateHover();
    const h = B.hover;
    if (B.tapMode === "paint") {
      B.painting = { fresh: true };
      return paint(B.painting);
    }
    if (B.tapMode || tapTool()) {
      if (!h) return;
      // a finger aims first and acts when it lifts; a mouse acts at once
      if (touch) return void ((B.aim = true), (B.key = ""));
      return tapAct();
    }
    if (B.tool === "select") {
      const now = performance.now(),
        id = B.hoverId,
        hd = handleAt();
      B.press = { x: e.clientX, y: e.clientY, id: hd ? B.sel[0] : id, hd, shift: e.shiftKey, o: ray.ray.origin.clone(), dir: ray.ray.direction.clone(), fo: hd || e.shiftKey ? null : freeOpenAt() };
      B.press.dbl = !!(id && !hd && B.lastClick && B.lastClick.id === id && now - B.lastClick.t < 380);
      B.lastClick = { id, t: now };
      return;
    }
    if (!h) return;
    // Shift starts a separate wing on the same grid, with its own height
    const wing = (e.shiftKey || B.wingNext) && !h.F.isNew ? { ox: h.F.ox, oz: h.F.oz, yaw: h.F.yaw, y0: h.F.y0 + B.lift, isNew: true, level: h.F.level, hs: B.hs, lift: B.lift } : null;
    if (B.wingNext) ((B.wingNext = false), touchUi());
    B.drag = { F: wing || freeze(h.F), a: anchorFor(h), t: performance.now(), mode: "drag", hit: B.tool === "door" || B.tool === "window" ? wallUnder(h) : null, x: e.clientX, y: e.clientY, fgrab: freeTool() ? B.fover : null };
    B.key = "";
    hint();
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
    B.ores && resizeEnd();
    liftFinger(e, false);
    B.painting = B.press = B.marq = B.ov.marq = null;
    if (e.pointerType === "touch") {
      if (B.drag && B.drag.mode === "drag") B.drag = null;
      if (B.move && !B.move.hand) moveEnd();
      setPtr(e, false);
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    if (B.ores) return void (fingers.delete(e.pointerId), resizeEnd());
    if (liftFinger(e, true)) return;
    const touch = e.pointerType === "touch";
    if (e.button === 2) {
      if (B.on && Math.hypot(e.clientX - B.ptr.rx, e.clientY - B.ptr.ry) < 6) putDown(true);
      return;
    }
    if (!B.on || e.button !== 0) return;
    if (B.painting) {
      B.painting = null;
      return void (touch && setPtr(e, false));
    }
    const pr = B.press;
    if (pr) {
      B.press = null;
      setPtr(e);
      updateHover();
      if (B.move) moveCommit();
      else if (B.marq) {
        const m = B.marq,
          ids = marqueeIds(m.x0, m.y0, m.x1, m.y1);
        B.marq = B.ov.marq = null;
        B.ovVer++;
        selSet(pr.shift ? [...B.sel, ...ids] : ids);
      } else if (!pr.go) {
        // a plain click: select, add to or drop from the selection, or clear it on open ground
        if (pr.hd) {
        } else if (pr.fo) return void (openFree(pr.fo), touch && setPtr(e, false));   // a door or window: its own tool, with it selected
        else if (pr.dbl) (selSet([pr.id]), (B.inspNow = true), (B.uiVer++));   // a double click opens the inspector on it
        else if (!pr.id) pr.shift || selSet([]);
        else if (pr.shift) selSet(B.sel.includes(pr.id) ? B.sel.filter((x) => x !== pr.id) : [...B.sel, pr.id]);
        else {
          const q = refOf(pr.id);
          if (q && /roof/.test(q.kind)) B.selRoofAuto = false;
          selSet([pr.id]);
        }
      }
      if (touch) setPtr(e, false);
      return;
    }
    if (!B.drag || B.drag.mode !== "drag") return void (touch && setPtr(e, false));
    setPtr(e);
    updateHover();
    const d = B.drag,
      still = Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5;
    if (still && (B.tool === "room" || B.tool === "wall" || B.tool === "path" || B.tool === "tower")) {
      // a plain click: switch to click-to-click drawing
      if (performance.now() - d.t < 350) d.mode = "click";
      else B.drag = null;
      B.key = "";
      hint();
      if (touch) setPtr(e, false);
      return;
    }
    if (freeTool() && d.fgrab && still) {
      // a click on an opening selects it; a drag has moved it
      B.fsel = d.fgrab;
      B.drag = null;
      B.key = "";
      hint();
      touchUi();
      if (touch) setPtr(e, false);
      return;
    }
    if (freeTool() && !d.fgrab) B.fsel = null;
    commit();
    if (touch) setPtr(e, false);
  });
  // the free door or window under the pointer, for Select (pickAt finds the wall it is in)
  function freeOpenAt() {
    const pk = pickAt(ANY_PIECE);
    if (!pk || pk.kind !== "wall" || !pk.run || pk.u === undefined) return null;
    const ax = runAx(pk.S, pk.run),
      along = ax.t0 + pk.u * (ax.t1 - ax.t0),
      o = pk.S.fopen.find((q) => q.g === pk.run && along >= q.f.pos - 0.05 && along <= q.f.pos + q.sp.w + 0.05 && (pk.y === undefined || (pk.y >= q.sp.sill - 0.1 && pk.y <= q.sp.head + 0.1)));
    return o ? { id: o.f.id, kind: o.sp.type.kind } : null;
  }
  // Select on a free door or window: one way to edit an opening. Its own tool comes up with it selected and the
  // designer open; Esc goes back to Select.
  function openFree(fo) {
    selSet([]);
    setTool(fo.kind);
    if (fo.kind === "window") B.wleg = false;
    else B.dleg = false;
    B.fsel = fo.id;
    B.fromSel = true;
    B.key = "";
    hint();
    touchUi();
  }
  // put down what is in hand: a stroke, a copy, a measurement half taken. With nothing in hand, go home to Select.
  function putDown(home) {
    if (B.typed.a !== null || B.typed.b !== null) return (typedClear(), true);
    if (B.tool === "equip" && (FX.from || FX.moving || FX.sel)) return ((FX.from = FX.moving = FX.sel = null), FX.v++, (B.key = ""), touchUi(), true);
    if (B.move) return (moveEnd(), true);
    if (B.marq) return ((B.marq = B.ov.marq = B.press = null), B.ovVer++, true);
    if (B.drag) return ((B.drag = null), (B.key = ""), hint(), touchUi(), true);
    if (B.tapMode) return ((B.tapMode = ""), (B.key = ""), touchUi(), true);
    if (B.measA) return ((B.measA = null), (B.key = ""), measDraw(null), touchUi(), true);
    if (B.tool === "copy" && B.clipb) return ((B.clipb = null), setTool("select"), true);
    if (B.fromSel && (B.tool === "door" || B.tool === "window")) return (setTool("select"), true);
    if (home && B.tool !== "select") return (setTool("select"), true);
    if (B.tool === "select" && B.sel.length) return (selSet([]), true);
    return false;
  }
  // Shift and the wheel swaps the style in hand, Ctrl and the wheel the material, without leaving the view
  window.addEventListener(
    "wheel",
    (e) => {
      if (!B.on || e.target !== canvas || !(e.shiftKey || e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();
      const back = (e.deltaY || e.deltaX) < 0;
      if (e.shiftKey) cycleStyle(back);
      else ((B.ctrlWheel = true), cycleMat(back));
    },
    { capture: true, passive: false },
  );

  /* ---------- tools and their options ---------- */
  // The interface (src/buildui.js) draws what view() describes and reports clicks through choose(). With a drawing
  // tool the options are those of the NEXT piece; with a selection they are the selected pieces' own properties.
  // what the player left as they liked it: whether the inspector is open, and whether the first-run chips are done
  function prefsLoad() {
    if (B.insp !== undefined) return;
    try {
      B.insp = localStorage.getItem("build:insp") === "1";
      B.coached = localStorage.getItem("build:coached") === "1";
    } catch {
      B.insp = B.coached = false;
    }
  }
  const prefSave = (k, on) => {
    try {
      localStorage.setItem(k, on ? "1" : "");
    } catch {}
  };
  const sandboxOn = () => {
    const c = G.sim && G.sim.state && G.sim.state.sys && G.sim.state.sys.construction;
    return !c || !!(c.options && c.options.sandbox);
  };
  // the first-run chips: a room, a door, a roof, then Done. Worked out once per change to the plan.
  const COACH = { v: -1, steps: null };
  function coachSteps() {
    if (COACH.v === B.version && COACH.steps) return COACH.steps;
    const q = quantities(),
      room = q.floorArea > 0 && q.wallLength > 0,
      door = room && q.doors > 0,
      roof = room && q.roofArea > 0;
    COACH.v = B.version;
    return (COACH.steps = [
      { id: "room", text: "Room", done: room, tool: "room" },
      { id: "door", text: "Door", done: door, tool: "door" },
      { id: "roof", text: "Roof", done: roof, tool: "roof" },
      { id: "done", text: "Done", done: false, tool: null },
    ]);
  }
  function coachEnd() {
    B.coached = true;
    prefSave("build:coached", true);
  }
  // the plan's cost, for the Materials button (null in sandbox, where nothing is bought)
  const TOTAL = { v: -1, total: 0 };
  function planTotal() {
    if (sandboxOn()) return null;
    if (TOTAL.v === B.version) return TOTAL.total;
    const items = G.stock && G.stock.ITEMS;
    let total = 0;
    for (const ln of FR.materialsList(listPieces().filter((p) => p.stage))) if (ln.itemId && items && items[ln.itemId]) total += items[ln.itemId].priceUsd * ln.qty;
    TOTAL.v = B.version;
    return (TOTAL.total = Math.round(total));
  }
  // the storeys as chips: the cellar (dim until one is dug), each storey that exists, and one empty one above the top
  function levelChips() {
    const has = new Set();
    for (const S of B.structs) S.po || has.add(S.level);
    let top = 0;
    for (const l of has) top = Math.max(top, l);
    const out = [{ l: -1, name: "Cellar", has: has.has(-1), cur: B.level === -1 }];
    for (let l = 0; l <= Math.min(3, Math.max(top + 1, B.level)); l++) out.push({ l, name: l === 0 ? "Ground" : l > top && l !== B.level ? "+" : String(l + 1), has: has.has(l), cur: B.level === l });
    return out;
  }
  function setTool(id) {
    if (B.tool !== id && (B.tool === "select" || id !== "select")) B.showRoofs = B.selRoofAuto = false;
    if (B.tool !== id) {
      // Door and Window open the inspector (their designer); other tools leave it as the player last had it
      B.inspNow = id === "window" || id === "door" ? true : null;
      B.fromSel = false;
    }
    if (B.tool !== id && (id === "window" || id === "door")) {
      const was = OP.openingType(B.otype);
      if (was) B.odSave[was.kind] = B.od;
      B.otype = id === "window" ? B.owin : B.odoor;
      B.od = B.odSave[id] || { w: null, h: null, finish: null, look: {} };
      B.osize = Math.min(B.osize, OP.openingSizes(B.otype).length - 1);
      B.fsel = null;
    }
    B.tool = id;
    FX.from = FX.moving = FX.sel = null;
    FX.v++;
    fxGhost.visible = false;
    B.drag = null;
    B.tapMode = "";
    B.measA = null;
    B.move && moveEnd();
    typedClear();
    B.key = "";
    hint();
    touchUi();
  }
  const LEVEL_NAME = (l) => (l > 0 ? "Storey " + (l + 1) : l < 0 ? "Cellar" : "Ground");
  function setLevel(l) {
    B.level = clamp(l, -1, 3);
    B.drag = null;
    B.key = "";
    selSet([]);
    touchUi();
  }
  // the ceiling height of the storey under the cursor, or of what is built next
  function cycleHeight(back) {
    const h = B.hover,
      S = h && !h.F.isNew ? h.F : null,
      cur = S ? S.hs : B.hs,
      n = HEIGHTS.findIndex((x) => x[0] === cur),
      next = HEIGHTS[(n + (back ? HEIGHTS.length - 1 : 1)) % HEIGHTS.length];
    B.hs = next[0];
    S && setStorey(S, next[0]);
    B.key = "";
    touchUi();
  }
  const matCat = () => (B.tool === "roof" ? ["rmat", ROOFS] : B.tool === "floor" ? ["fmat", FLOORS] : B.tool === "path" ? ["pmat", PATHS] : ["wmat", WALLS]);
  const cyc = (list, cur, back) => list[(list.indexOf(cur) + (back ? list.length - 1 : 1)) % list.length];
  const overTower = () => !!B.hover && !B.hover.F.isNew && ringAt(B.hover.F, B.hover.lx, B.hover.lz) >= 0;
  // step through the styles of the tool in hand
  function cycleStyle(back) {
    const t = B.tool;
    if (t === "tower") B.levels = back ? ((B.levels + 2) % 4) + 1 : (B.levels % 4) + 1;
    else if (t === "wall") B.style = cyc(Object.keys(STYLE_NAME), B.style, back);
    else if (t === "window" && !B.wleg) choose("otype", cyc(OP.OPENING_TYPES.filter((x) => x.kind === "window").map((x) => x.id), B.otype, back));
    else if (t === "door" && !B.dleg) choose("otype", cyc(OP.OPENING_TYPES.filter((x) => x.kind === "door").map((x) => x.id), B.otype, back));
    else if (t === "window") B.wstyle = cyc(Object.keys(WIN_NAME), B.wstyle, back);
    else if (t === "door") B.dstyle = cyc(Object.keys(DOOR_NAME), B.dstyle, back);
    else if (t === "pillar") B.pkind = B.pkind === "pillar" ? "chimney" : "pillar";
    else if (t === "stairs") B.stairDir = (B.stairDir + (back ? 3 : 1)) % 4;
    else if (t === "path") B.pwidth = cyc([1, 2, 3], B.pwidth, back);
    else if (t === "decor") B.drot = (B.drot + (back ? 7 : 1)) % 8;
    else if (t === "equip") fxChoose("fx:turn");
    else if (t === "copy") B.clipb && (B.clipb.rot = (B.clipb.rot + (back ? 7 : 1)) % 8);
    else if (t === "roof") {
      if (overTower()) B.tshape = cyc(Object.keys(TOP_NAME), B.tshape, back);
      else B.rsh = cyc(Object.keys(ROOF_SHAPES), B.rsh, back);
    } else if (t === "select" && B.sel.length) selEdit((q) => (q.kind === "decor" ? ((q.it[3] = ((q.it[3] || 0) + (back ? 7 : 1)) % 8), true) : false));
    B.key = "";
    touchUi();
  }
  function cycleMat(back) {
    if (B.tool === "decor") B.dcol = (B.dcol + (back ? DYES.length - 1 : 1)) % DYES.length;
    else {
      const [k, set] = matCat();
      B[k] = cyc(Object.keys(set), B[k], back);
    }
    B.key = "";
    touchUi();
  }
  // the piece under the cursor, for painting with the material in hand
  function targetAt() {
    const pk = pickAt(ANY_PIECE);
    if (!pk) return null;
    const S = pk.S,
      strip = B.tool === "room" || B.tool === "tower" ? ["wmat", "fmat"] : B.tool === "decor" ? ["dcol"] : [matCat()[0]];
    let t = null;
    if (pk.kind === "wall" && pk.free) {
      const segs = B.brush === "run" ? pk.run.m.map((n) => S.segs[n]) : [S.segs[pk.idx]];
      t = { cat: "wmat", get: () => segs[0][5] || "timber", set: (m) => segs.forEach((sg) => (sg[5] = m)) };
    } else if (pk.kind === "wall") {
      const keys = B.brush === "run" ? pk.run.m.map((e) => e.k) : [ek(pk.i, pk.j, pk.d)];
      t = { cat: "wmat", get: () => S.wmat.get(ek(pk.i, pk.j, pk.d)) || "timber", set: (m) => keys.forEach((k) => setW(S, k, m)) };
    } else if (pk.kind === "ring" && pk.side !== undefined) t = { cat: "wmat", get: () => S.rings[pk.ri].mat || "timber", set: (m) => (S.rings[pk.ri].mat = m) };
    else if (pk.kind === "ring") t = { cat: "fmat", get: () => S.rings[pk.ri].fmat || "planks", set: (m) => (S.rings[pk.ri].fmat = m) };
    else if (pk.kind === "pillar") t = { cat: "wmat", get: () => S.pillars[pk.idx][2] || "timber", set: (m) => (S.pillars[pk.idx][2] = m) };
    else if (pk.kind === "floor" && pk.poly !== undefined) t = { cat: "fmat", get: () => S.polys[pk.poly].fmat || "planks", set: (m) => S.pids.forEach((q) => q[2] === pk.id && (q[3] = m)) };
    else if (pk.kind === "floor") {
      const cells = B.brush === "run" ? S.regs.find((g) => g.id === pk.id).m : [ck(pk.ci, pk.cj)];
      t = { cat: "fmat", get: () => S.fmat.get(ck(pk.ci, pk.cj)) || "planks", set: (m) => cells.forEach((c) => (m !== "planks" ? S.fmat.set(c, m) : S.fmat.delete(c))) };
    } else if (pk.kind === "roof") t = { cat: "rmat", get: () => pk.r.mat || "thatch", set: (m) => (pk.r.mat = m) };
    else if (pk.kind === "ringroof") t = { cat: "rmat", get: () => S.rings[pk.ri].rmat || "thatch", set: (m) => (S.rings[pk.ri].rmat = m) };
    else if (pk.kind === "polyroof") t = { cat: "rmat", get: () => S.polys[pk.pi].rmat || "thatch", set: (m) => S.polyRoofs.forEach((q) => q[3] === pk.id && (q[2] = m)) };
    else if (pk.kind === "path") t = { cat: "pmat", get: () => S.paths[pk.idx][5] || "cobble", set: (m) => (S.paths[pk.idx][5] = m) };
    else if (pk.kind === "decor") t = { cat: "dcol", get: () => S.decor[pk.idx][4] || 0, set: (m) => (S.decor[pk.idx][4] = m) };
    if (!t || !strip.includes(t.cat)) return null;
    t.S = S;
    return t;
  }
  // paint the piece under the cursor; a drag across several pieces is one undo step
  function paint(st) {
    const t = targetAt();
    if (!t || t.get() === B[t.cat]) return;
    if (st.fresh) (pushUndo(), (st.fresh = false));
    t.set(B[t.cat]);
    rebuild(t.S);
    touchUi();
  }
  // Build mode frames the site in the part of the view the bar leaves free: the picture is shifted up by half the
  // bar's height. It is an off-centre projection, so the camera itself, picking and the post pass all stay in step.
  const VIEW = { off: 0, w: 0, h: 0 };
  window.addEventListener("resize", () => (VIEW.w = 0));
  function frameView(dt) {
    const want = B.on ? Math.round((B.barH || 0) / 2) : 0;
    if (VIEW.off === want && (VIEW.w || !want)) return;
    const d = want - VIEW.off;
    VIEW.off = Math.abs(d) < 0.75 ? want : VIEW.off + d * (1 - Math.exp(-14 * dt));
    VIEW.w = window.innerWidth;
    VIEW.h = window.innerHeight;
    if (VIEW.off > 0.25) G.camera.setViewOffset(VIEW.w, VIEW.h, 0, VIEW.off, VIEW.w, VIEW.h);
    else if (G.camera.view) G.camera.clearViewOffset();
    B.key = "";
  }
  function toggle() {
    if (P.tool !== "build") {
      B.prevTool = P.tool;
      G.setTool("build");
    } else G.setTool(B.prevTool === "build" ? "axe" : B.prevTool);
  }
  function enter() {
    B.on = true;
    prefsLoad();
    // a player whose first building already has a room, a door and a roof is not coached
    if (!B.coached && coachSteps().every((c) => c.done || c.id === "done")) coachEnd();
    for (const S of B.structs) B.dirty.add(S);
    // building wants a free cursor and a higher, steadier view
    try {
      document.pointerLockElement && document.exitPointerLock();
    } catch {}
    shellMat.uniforms.uOp.value = 0.5;
    B.camSaved = { pitch: G.cam.pitch, dist: G.cam.dist };
    B.camT = 0.6;
    G.refreshLock && G.refreshLock();
    document.body.classList.add("building");
    $("buildbar").hidden = false;
    for (const S of B.structs) S.gapMesh && (S.gapMesh.visible = true);
    B.key = "";
    FX.v++;
    measDraw(null);
    hint();
    touchUi();
  }
  function exit() {
    const was = B.on;
    B.on = false;
    if (was) {
      // what happens after planning: the plan waits for its materials (sandbox builds as it is drawn)
      const left = listPieces().filter((p) => p.built === false && (!p.parent || p.kind === "door" || p.kind === "window")).length;
      if (left && !sandboxOn() && window.__ui && window.__ui.toast) window.__ui.toast("Plan saved: " + plural(left, "piece") + " to build. Open Build (L) to order materials.", { tone: "info", seconds: 5 });
      if (!B.coached && coachSteps().every((c) => c.done || c.id === "done")) coachEnd();
    }
    { const dp = document.getElementById("bdesign"); if (dp) dp.hidden = true; }   // the designer panel goes with build mode
    for (const S of B.structs) B.dirty.add(S);
    if (B.camSaved) {
      G.cam.pitch = B.camSaved.pitch;
      G.cam.dist = B.camSaved.dist;
      B.camSaved = null;
    }
    G.refreshLock && G.refreshLock();
    shellMat.uniforms.uOp.value = 0.3;
    B.drag = null;
    B.tapMode = "";
    B.press = B.marq = B.ov.marq = null;
    B.move && moveEnd();
    document.body.classList.remove("building");
    $("buildbar").hidden = true;
    ghostGroup.visible = gridGroup.visible = selGroup.visible = measMesh.visible = fxGhost.visible = fxHi.visible = false;
    FX.v++;
    B.ov.dims.length = 0;
    B.ov.snap = null;
    label("");
    B.ovVer++;
    for (const S of B.structs) S.gapMesh && (S.gapMesh.visible = false);
    touchUi();
  }

  // colours as the page writes them
  const hexOf = (c) => "#" + new T.Color(c[0], c[1], c[2]).getHexString();
  const swatches = (set, kind) =>
    Object.keys(set).map((k) => {
      const m = set[k];
      return { v: k, name: m.name, sw: kind === "wall" ? [m.courses ? "courses" : m.brace ? "brace" : m.flat ? "flat" : "planks", hexOf(m.plank), hexOf(m.beam)] : [kind === "floor" ? (m.c2 ? "check" : k === "planks" || k === "dark" ? "boards" : "plain") : kind === "roof" ? (k === "asphalt" ? "asph" : { seam: "seam", corr: "corr", flat: "plain", green: "green" }[m.look] || "roof") : kind, hexOf(m.c), hexOf(m.c2 || shade(m.c, kind === "roof" && m.look === "seam" ? 1.5 : 0.72))] };
    });
  const SW = { wall: swatches(WALLS, "wall"), floor: swatches(FLOORS, "floor"), roof: swatches(ROOFS, "roof"), path: swatches(PATHS, "path"), dye: DYES.map((d, n) => ({ v: n, name: d[0], sw: ["dye", hexOf(d[1]), hexOf(d[1])] })) };
  const tiles = (names, pre) => Object.keys(names).map((k) => ({ v: k, name: names[k], icon: pre + k }));
  const STYLE_SHORT = { wall: "Wall", arch: "Arch", arch2: "Pointed", arch3: "Braced", rail: "Fence" };
  const WIN_SHORT = { window: "Square", window2: "Arched", window4: "Shuttered" };
  const DOOR_SHORT = { door: "Door", door2: "Double" };
  const TOP_SHORT = { cone: "Pointed", dome: "Dome" };
  const G_ = {
    sw: (id, label, items, value, key) => ({ type: "swatches", id, label, items, value, key }),
    tiles: (id, label, items, value, key) => ({ type: "tiles", id, label, items, value, key }),
    chips: (id, label, items, value, key) => ({ type: "chips", id, label, items, value, key }),
    toggle: (id, name, on, icon, title) => ({ type: "toggle", id, name, on, icon, title }),
    act: (id, name, icon, key, danger) => ({ type: "action", id, name, icon, key, danger }),
    step: (id, label, text, key) => ({ type: "stepper", id, label, text, key }),
    field: (id, label, value, unit, title) => ({ type: "field", id, label, value, unit, title }),
    info: (title, text) => ({ type: "info", title, text }),
    select: (id, label, items, value, title) => ({ type: "select", id, label, items, value, title }),
  };
  const FOUND_ITEMS = ["pier-blocks", "skids", "piers", "stemwall", "slab", "plinth"].map((v) => ({ v, name: window.__framing.FOUNDATIONS[v].name })),
    INS_ITEMS = [{ v: null, name: "None" }, { v: "fibreglass_batt", name: "Fibreglass batts" }, { v: "mineral_wool", name: "Mineral wool" }, { v: "sheep_wool", name: "Sheep's wool" }],
    LIN_ITEMS = [{ v: null, name: "None" }, { v: "boards", name: "Pine boards" }, { v: "gypsum", name: "Drywall" }];
  // the wall paints and sheens, from the simulation's content (docs/design/interior-finishes.md)
  const decoC = () => {
    const y = G.sim && G.sim.systems.find((x) => x.name === "construction");
    return y && y.api.content;
  };
  const hex6 = (n) => "#" + n.toString(16).padStart(6, "0");
  const DECO_ITEMS = (none) => {
    const c = decoC();
    return [{ v: null, name: none, sw: ["bare", "#e7e3da", "#b9b2a4"] }].concat(c ? c.PAINTS.map((p) => ({ v: p[0], name: p[1], sw: ["dye", hex6(p[2]), hex6(p[2])] })) : []);
  };
  const SHEEN_ITEMS = () => {
    const c = decoC();
    return c ? Object.keys(c.SHEENS).filter((v) => v !== "semigloss").map((v) => ({ v, name: c.SHEENS[v].name })) : [];
  };
  // a building's finishes, by surface (src/framing.js finFor): { walls, faces, trim, items }, each "<colour>_<sheen>"
  const finParts = (fin, sheen) => {
    const [c, sh] = String(fin || "").split("_");
    return { colour: c || null, sheen: sh || sheen };
  };
  const decoWith = (d, id, v) => {
    const o = JSON.parse(JSON.stringify(d || {})),
      w = finParts(o.walls, "eggshell");
    if (id === "deco") o.walls = v ? v + "_" + w.sheen : null;
    else if (id === "sheen") o.walls = w.colour ? w.colour + "_" + v : null;
    else if (id === "trim") o.trim = v ? v + "_semigloss" : null;
    for (const k of Object.keys(o)) if (!o[k] || (typeof o[k] === "object" && !Object.keys(o[k]).length)) delete o[k];
    return Object.keys(o).length ? o : null;
  };
  // a building's make-up, in the inspector: what it stands on and is made of (Construction), then its paint (Finish)
  const makeUp = (g, pre, f, i, l, d) => {
    const put = (x, sec) => g.push(((x.sec = sec), x));
    put(G_.select(pre + "found", "Stands on", FOUND_ITEMS, f, (window.__framing.FOUNDATIONS[f] || {}).note), "Construction");
    put(G_.select(pre + "ins", "Insulation", INS_ITEMS, i, "What fills the spaces between studs, joists and rafters"), "Construction");
    put(G_.select(pre + "lining", "Inside", LIN_ITEMS, l, "What covers the inside of the walls"), "Construction");
    if (l) {
      const q = finParts(d && d.walls, "eggshell");
      put(G_.sw(pre + "deco", "Walls", DECO_ITEMS("Bare"), q.colour, "deco"), "Finish");
      if (q.colour) put(G_.select(pre + "sheen", "Paint finish", SHEEN_ITEMS(), q.sheen, "Matte hides a wall's bumps; satin wipes clean"), "Finish");
    }
    put(G_.sw(pre + "trim", "Trim", DECO_ITEMS("As it comes"), finParts(d && d.trim).colour, "trim"), "Finish");
  };
  // the shopping list as the Schedule panel shows it: by stage, with what each line costs and how far along it is
  function schedule() {
    const S = B.sel.length ? (selRefs()[0] || {}).S : null,
      grp = S ? groupOf(S) : null,
      ids = grp ? new Set(grp.map((O) => O.id)) : null,
      pcs = listPieces().filter((p) => p.stage && (!ids || ids.has(p.struct))),
      items = G.stock && G.stock.ITEMS,
      stages = [];
    let total = 0;
    for (const ln of FR.materialsList(pcs)) {
      let st = stages[stages.length - 1];
      if (!st || st.id !== ln.stage) {
        const of = pcs.filter((p) => p.stage === ln.stage);
        stages.push((st = { id: ln.stage, name: FR.STAGE_NAME[ln.stage], lines: [], cost: 0, built: of.filter((p) => p.built).length, of: of.length }));
      }
      const cost = ln.itemId && items && items[ln.itemId] ? items[ln.itemId].priceUsd * ln.qty : 0;
      st.lines.push({ label: ln.label, qty: fmt(ln.qty) + (ln.unit === "each" ? "" : " " + ln.unit.replace("m2", "m²").replace("m3", "m³")), why: ln.why, cost, missing: !ln.itemId });
      st.cost += cost;
      total += cost;
    }
    return { title: grp ? "This building" : "Everything planned and built", stages, total };
  }
  const hsItems = () => HEIGHTS.map((x) => ({ v: x[0], name: x[1], note: fmtM(EAVE * x[0]) }));
  const gapItems = (unit) => [1, 2, 3, 4].map((v) => ({ v, name: v + " m", note: unit }));
  const PAINT = () => [G_.toggle("paint", "Paint", B.tapMode === "paint", "paint", "Paint pieces already built with this material: click or drag across them (K)"), G_.toggle("pick", "Pick", B.tapMode === "pick", "pick", "Take the style and material of any piece in hand (I)")];
  // what the selection adds up to, from the piece list
  function selPieces() {
    const sel = new Set(B.sel);
    return listPieces().filter((p) => sel.has(p.id) || sel.has(p.roof) || sel.has(p.tower) || (p.wall && sel.has(p.wall)));
  }
  function quantText(q) {
    const out = [];
    q.wallLength && out.push("walls " + fmtM(q.wallLength));
    q.floorArea && out.push("floor " + fmtA(q.floorArea));
    q.roofArea && out.push("roof " + fmtA(q.roofArea));
    q.doors && out.push(plural(q.doors, "door"));
    q.windows && out.push(plural(q.windows, "window"));
    q.posts && out.push(plural(q.posts, "pillar"));
    q.fixtures && out.push(plural(q.fixtures, "furnishing"));
    q.pathLength && out.push("path " + fmtM(q.pathLength));
    return out.join(" · ");
  }
  function selGroups(g) {
    const refs = selRefs(),
      one = refs.length === 1 ? refs[0] : null,
      kinds = new Set(refs.map((q) => q.kind)),
      has = (...k) => k.some((x) => kinds.has(x)),
      common = (vals) => (vals.length && vals.every((v) => v === vals[0]) ? vals[0] : null),
      ps = selPieces();
    // what it is and what it measures, without being asked
    let title = plural(refs.length, "piece"),
      text = quantText(quantities(ps));
    if (one) {
      const p = pieceById(one.id) || ps[0],
        S = one.S;
      if (one.kind === "run" || one.kind === "frun") ((title = WALLS[one.g.mat].name + " " + STYLE_SHORT[baseType(one.g.cls)].toLowerCase()), (text = fmtM(p.length) + " long · " + fmtM(p.height) + " high · " + fmtA(p.netArea) + (p.openings.length ? " · " + plural(p.openings.length, "opening") : "")));
      else if (one.kind === "open" || one.kind === "sopen") ((title = (WIN_NAME[p.type] || DOOR_NAME[p.type] || "Gate")), (text = fmtM(p.length) + " wide · " + fmtM(p.height) + " high"));
      else if (one.kind === "floor" || one.kind === "poly") ((title = FLOORS[p.material].name + " floor"), (text = fmtA(p.area) + " · " + fmtM(p.perimeter) + " around"));
      else if (one.kind === "roof" || one.kind === "polyroof") ((title = ROOFS[ps[0].material].name + " " + (ROOF_SHAPES[ps[0].type] || "pointed").toLowerCase() + " roof"), (text = fmtA(ps.reduce((a, q) => a + (q.kind === "roof" ? q.area : 0), 0)) + " · pitch " + Math.round(ps[0].pitchDeg) + "°"));
      else if (one.kind === "ring") ((title = "Round room"), (text = fmtM(one.r.r * 2) + " wide · " + plural(one.r.h, "storey") + " · " + fmtA(p.area)));
      else if (one.kind === "stair") ((title = "Stairs"), (text = fmtM(p.length) + " long · rises " + fmtM(p.height)));
      else if (one.kind === "pillar") ((title = one.p[3] === "chimney" ? "Chimney" : "Pillar"), (text = fmtM(p.height) + " high"));
      else if (one.kind === "path") ((title = PATHS[p.material].name + " path"), (text = fmtM(p.length) + " long · " + fmtM(p.width) + " wide"));
      else if (one.kind === "decor") ((title = p.name), (text = fmt(p.width) + " × " + fmt(p.depth) + " m · " + fmtM(p.height) + " high"));
      void S;
    } else if (kinds.size === 1 && has("run", "frun")) title = plural(refs.length, "wall");
    g.push(G_.info(title, text));
    const walls = refs.filter((q) => q.kind === "run" || q.kind === "frun");
    if (walls.length) {
      const st = common(walls.map((q) => { const ty = (q.kind === "run" ? q.g.m.map((e) => e.type) : q.g.mods.map((m) => m.type)).filter((t) => !isDoor(t) && !isWin(t)); return ty.length && ty.every((t) => t === ty[0]) ? ty[0] : baseType(q.g.cls); }));
      g.push(G_.tiles("s:style", "Style", tiles(STYLE_SHORT, "w-"), st));
    }
    if (has("run", "frun", "ring", "pillar")) g.push(G_.sw("s:wmat", has("ring") && !walls.length ? "Walls" : "Material", SW.wall, common(refs.filter((q) => /^(run|frun|ring|pillar)$/.test(q.kind)).map((q) => (q.g ? q.g.mat : q.r ? q.r.mat || "timber" : q.p[2] || "timber")))));
    if (one && (one.kind === "open" || one.kind === "sopen")) {
      const ty = one.kind === "open" ? one.S.walls.get(one.k) : one.sg[4];
      if (ty !== "railgate") g.push(G_.tiles("s:otype", "Type", [...tiles(DOOR_SHORT, "d-"), ...tiles(WIN_SHORT, "n-")], ty));
    }
    if (has("floor", "poly", "ring")) g.push(G_.sw("s:fmat", "Floor", SW.floor, common(refs.filter((q) => /^(floor|poly|ring)$/.test(q.kind)).map((q) => (q.g ? q.g.mat : q.p ? q.p.fmat || "planks" : q.r.fmat || "planks")))));
    if (one && one.kind === "roof") {
      const r = one.r,
        sh = r.shape || "gable";
      g.push(G_.tiles("s:rshape", "Shape", tiles(ROOF_SHAPES, "r-"), sh));
      if (TURNS[sh]) g.push(G_.act("s:rturn", "Turn", "turn"));
      roofPlanView(g, "s:", { shape: sh, pitch12: pitchOf(r), eave: eaveOf(r), rake: rakeOf(r), gutters: !!r.gutters, color: r.color || null, mat: r.mat || "thatch" }, r);
    }
    if (one && one.kind === "ring") {
      g.push(G_.chips("s:levels", "Storeys", [1, 2, 3, 4].map((v) => ({ v, name: String(v) })), one.r.h));
      g.push(G_.tiles("s:top", "Top", [{ v: "", name: "Open", icon: "t-none" }, ...tiles(TOP_SHORT, "t-")], one.r.roof === true ? "cone" : one.r.roof || ""));
    }
    if (has("roof", "polyroof") || (one && one.kind === "ring" && one.r.roof)) roofSwatches(g, "s:rmat", common(refs.filter((q) => /roof|ring/.test(q.kind)).map((q) => (q.kind === "roof" ? q.r.mat || "thatch" : q.kind === "ring" ? q.r.rmat || "thatch" : q.p.rmat || "thatch"))));
    if (one && one.kind === "pillar") g.push(G_.tiles("s:pkind", "Kind", [{ v: "pillar", name: "Pillar", icon: "p-pillar" }, { v: "chimney", name: "Chimney", icon: "p-chimney" }], one.p[3] || "pillar"));
    if (has("path")) {
      g.push(G_.chips("s:pwidth", "Width", [1, 2, 3].map((v) => ({ v, name: v + " m" })), common(refs.filter((q) => q.kind === "path").map((q) => q.p[4]))));
      g.push(G_.sw("s:pmat", "Surface", SW.path, common(refs.filter((q) => q.kind === "path").map((q) => q.p[5] || "cobble"))));
    }
    if (has("decor")) {
      g.push(G_.sw("s:dcol", "Colour", SW.dye, common(refs.filter((q) => q.kind === "decor").map((q) => q.it[4] || 0))));
      g.push(G_.act("s:turn", "Turn", "turn"));
    }
    if (one) {
      const S = one.S;
      if (one.kind === "run") g.push(G_.field("s:len", "Length", fmt(one.g.m.length), "m", "Whole metres on the grid"));
      else if (one.kind === "frun") g.push(G_.field("s:len", "Length", fmt(one.g.len), "m", "Any length"));
      if (one.kind === "ring") g.push(G_.field("s:width", "Width", fmt(one.r.r * 2), "m"));
      if (/^(run|frun|floor|ring|pillar)$/.test(one.kind) && !(one.g && one.g.cls === "rail")) g.push(G_.field("s:hs", "Ceiling", fmt(EAVE * S.hs), "m", "The height of this whole storey"));
      if (one.kind === "decor" || one.kind === "pillar" || one.kind === "ring") {
        const at = one.kind === "decor" ? one.it : one.kind === "pillar" ? one.p : [one.r.cx, one.r.cz];
        g.push(G_.field("s:x", "Across", fmt(at[0]), "m", "Position on the building's grid"));
        g.push(G_.field("s:z", "Along", fmt(at[1]), "m", "Position on the building's grid"));
      }
    }
    if (refs.length && !refs[0].S.po && refs.every((q) => groupOf(refs[0].S).includes(q.S))) {
      const S0 = groupOf(refs[0].S).find((O) => O.level === 0) || refs[0].S,
        left = groupOf(S0).reduce((a, O) => a + O.plan.size, 0);
      if (left) g.push(G_.info("Being built", plural(left, "piece") + " still to build"));
      makeUp(g, "s:", S0.found, S0.ins, S0.lining, S0.deco);
    }
    g.push(G_.act("s:all", "Whole building", "building"));
    if (one) g.push(G_.act("s:pick", "More like this", "pick", "I"));
    g.push(G_.act("s:dup", "Copy", "copy", "Ctrl D"));
    g.push(G_.act("s:del", "Delete", "bin", "Del", true));
  }
  // roofing swatches: one group, classic then modern (each item's grp says which)
  function roofSwatches(g, id, value, key) {
    const items = [];
    for (const grp of ["classic", "modern"]) for (const x of SW.roof) (ROOFS[x.v].group || "classic") === grp && items.push({ ...x, grp });
    g.push(G_.sw(id, "Roofing", items, value, key));
  }
  const PITCH_CHIPS = [3, 4, 6, 8, 10, 12];
  // the plan of a roof, in the designer panel: what it measures and what to watch, its pitch, overhangs and finish.
  // pre "" works on the roof in hand, "s:" on the selected one; r is a roof to measure (the one under the cursor)
  function roofPlanView(g, pre, cur, r) {
    const row = (x, sec) => ((x.row = "d"), sec && (x.sec = sec), g.push(x)),
      flat = cur.shape === "flat",
      probe = r || { i0: 0, i1: 5, j0: 0, j1: 3, ...roofFromHand({ i0: 0, i1: 5, j0: 0, j1: 3 }), ...cur },
      st = roofStats(r ? r : probe),
      warn = roofWarnings(cur.mat, st.lo, st.hi, flat ? 0 : cur.eave),
      M = ROOFS[cur.mat] || ROOFS.thatch;
    row({
      type: "badges",
      id: pre + "rbadges",
      items: [
        r ? { text: fmtA(st.area) + " of roofing", k: "std", title: "Measured on the slope, overhangs included" } : null,
        { text: flat ? "Flat · 1/4 in 12 to drain" : p12Text(cur.pitch12) + " · " + Math.round(degOf(cur.pitch12)) + "°", title: "Rise in inches for every 12 inches of run, and the angle" },
        st.lo !== st.hi && !flat ? { text: "Low slope " + p12Text(st.lo) + " · steep " + p12Text(st.hi), title: "This shape has two slopes" } : null,
        r && cur.gutters && st.downspouts ? { text: fmtM(st.gutterM) + " of gutter · " + plural(st.downspouts, "downspout"), title: "K-style gutters on every eave" } : null,
        ...warn.map((w) => ({ text: w.text, k: "bad", title: w.title })),
      ].filter(Boolean),
    });
    if (!flat) {
      row(G_.chips(pre + "pitch", "Pitch", PITCH_CHIPS.map((v) => ({ v, name: v + "/12", note: Math.round(degOf(v)) + "°" })), PITCH_CHIPS.includes(cur.pitch12) ? cur.pitch12 : undefined), "Pitch");
      row({ type: "num", id: pre + "pitchn", label: "Rise per 12", value: fmt(cur.pitch12), unit: "in", note: Math.round(degOf(cur.pitch12) * 10) / 10 + "°" + (M.min && st.lo < M.min ? " · needs " + p12Text(M.min) : "") , bad: !!(M.min && st.lo < M.min) || !!(M.max && st.hi > M.max) }, "Pitch");
    }
    row({ type: "num", id: pre + "eave", label: "Eave", value: fmt(cur.eave), unit: "m", note: cur.eave > 0.6 ? "needs brackets" : "past the wall", bad: cur.eave > 0.6 }, "Overhang");
    if (cur.shape !== "hip" && !flat) row({ type: "num", id: pre + "rake", label: cur.shape === "shed" ? "Sides and top" : "Gable ends", value: fmt(cur.rake), unit: "m", note: "past the wall" }, "Overhang");
    row(G_.toggle(pre + "gutters", "Gutters", !!cur.gutters, "roofs", "K-style gutters along every eave, with downspouts to the ground"), "Finish");
    if (M.colors) row(G_.chips(pre + "rcolor", "Colour", [{ v: null, name: "Standard" }, ...M.colors.map((c) => ({ v: c, name: ROOF_COLORS[c][0] }))], M.colors.includes(cur.color) ? cur.color : null), "Finish");
  }
  // Where each group of view() goes: tier 1 is the tray (what the next click draws), everything else the inspector
  // under its sec. Selection actions (s:all s:pick s:dup s:del) carry acts: true and sit beside the hint.
  const TRAY = {
    room: ["shape", "levels", "wmat", "fmat", "paint", "pick"],
    wall: ["style", "wmat", "paint", "pick"],
    floor: ["fmat", "paint", "pick"],
    roof: ["rshape", "rturn", "rmat", "roofall", "facts", "paint", "pick"],
    stairs: ["turn"],
    pillar: ["pkind", "wmat", "gap", "paint", "pick"],
    path: ["pwidth", "pmat", "paint", "pick"],
    // until the door and window rules (P5) sort their own: the catalogue in the tray, the rest in the designer
    door: ["otype", "gap", "paint", "pick"],
    window: ["otype", "gap", "paint", "pick"],
  };
  TRAY.tower = TRAY.room;
  const SEC_OF = { hs: "Level", lift: "Level", wing: "Level", tshape: "On a round room", "s:hs": "Level", "s:levels": "Level", "s:width": "Size", "s:x": "Position", "s:z": "Position", "rbadges": "Pitch", "s:rbadges": "Pitch", "w:prev": "Size", roofs: "View" };
  const SEL_STYLE = new Set(["s:style", "s:otype", "s:rshape", "s:rturn", "s:pkind", "s:pwidth", "s:top", "s:turn", "s:len"]),
    SEL_MAT = new Set(["s:wmat", "s:fmat", "s:rmat", "s:pmat", "s:dcol"]),
    SEL_ACTS = new Set(["s:all", "s:pick", "s:dup", "s:del"]);
  function tierOf(t, g) {
    const all = t === "decor" || t === "equip" || t === "measure" || t === "copy" || (t === "select" && !B.sel.length),
      tray = TRAY[t];
    let mat = false;
    g.forEach((x, n) => {
      let on = all || (tray && tray.includes(x.id));
      if (t === "select" && B.sel.length) {
        if (SEL_ACTS.has(x.id)) x.acts = true;
        // the selection's tray: what it is, its style, its first material, its length
        on = n === 0 || SEL_ACTS.has(x.id) || SEL_STYLE.has(x.id) || (SEL_MAT.has(x.id) && !mat && (mat = true));
        if (!on && x.type === "info") x.sec = x.sec || "Construction";
        if (!on && SEL_MAT.has(x.id)) x.sec = x.sec || "Material";
      }
      if (all && x.id === "roofs") on = false;
      if (on) x.tier = 1;
      else x.sec = x.sec || SEC_OF[x.id] || (t === "door" || t === "window" ? "Unit" : "More");
    });
  }
  const SEL_ICON = { run: "wall", frun: "wall", floor: "floor", poly: "floor", roof: "roof", polyroof: "roof", ring: "room", stair: "stairs", pillar: "pillar", path: "path", decor: "decor" };
  const NEXT_NAME = { room: "room", tower: "round room", wall: "wall", floor: "floor", roof: "roof", stairs: "stairs", path: "path", decor: "piece", equip: "equipment", copy: "copy" };
  // the inspector's head: the same drawer for the next piece and for the selected one
  function inspectorOf(t, g) {
    const any = g.some((x) => !x.tier),
      opening = t === "door" || t === "window",
      fs = opening && B.fsel && ((t === "window" && !B.wleg) || (t === "door" && !B.dleg)) ? fselOpen() : null,
      sel = t === "select" && B.sel.length > 0,
      open = any && !!(B.inspNow !== null && B.inspNow !== undefined ? B.inspNow : B.insp);
    if (opening) {
      const leg = t === "window" ? B.wleg : B.dleg,
        ty = OP.openingType(fs ? fs.f.typeId : B.otype);
      return { open, has: any, title: (fs ? "Selected " : "Next ") + t, sub: leg ? (t === "window" ? WIN_NAME[B.wstyle] : DOOR_NAME[B.dstyle]) || "Rustic" : ty ? ty.name : "", icon: t, mode: fs ? "sel" : "next" };
    }
    if (sel) {
      const q = selRefs(),
        k = q.length === 1 ? q[0].kind : null,
        ty = k === "open" ? q[0].S.walls.get(q[0].k) : k === "sopen" ? q[0].sg[4] : null;
      return { open, has: any, title: (g[0] && g[0].title) || "Selection", sub: (g[0] && g[0].text) || "", icon: ty ? (isDoor(ty) ? "door" : "window") : SEL_ICON[k] || "select", mode: "sel" };
    }
    const sub =
      t === "room" || t === "tower" ? WALLS[B.wmat].name + " walls · " + FLOORS[B.fmat].name.toLowerCase() + " floor"
      : t === "wall" ? STYLE_SHORT[B.style] + " · " + WALLS[B.wmat].name
      : t === "floor" ? FLOORS[B.fmat].name
      : t === "roof" ? ROOF_SHAPES[B.rsh] + " · " + ROOFS[B.rmat].name
      : t === "pillar" ? (B.pkind === "chimney" ? "Chimney" : "Pillar") + " · " + WALLS[B.wmat].name
      : t === "path" ? PATHS[B.pmat].name + " · " + B.pwidth + " m wide"
      : t === "decor" ? DECOR[B.dkind].name
      : "";
    return { open, has: any, title: NEXT_NAME[t] ? "Next " + NEXT_NAME[t] : (TOOLS.find((x) => x.id === t) || { name: "Build" }).name, sub, icon: t === "tower" ? "room" : t === "copy" ? "select" : t, mode: "next" };
  }
  function view() {
    const t = B.tool,
      g = [];
    const lift = () => g.push(G_.step("lift", "Raise", (B.lift > 0 ? "+" : "") + fmt(B.lift) + " m", "+ −"));
    const ceil = (label) => g.push(G_.chips("hs", label || "Ceiling", hsItems(), B.hs, "{ }"));
    const wing = () => g.push(G_.toggle("wing", "Split level", !!B.wingNext, "wing", "Start the next piece as its own level beside the floor under the cursor, at the raised height (or hold Shift)"));
    const facts = () => B.roomFacts && g.push({ ...G_.info(B.roomFacts.title, B.roomFacts.text), id: "facts" });
    B.fit = null;   // the door and window rules (openingView) fill it in
    if (t === "select") {
      if (B.sel.length) selGroups(g);
      else {
        g.push(G_.toggle("roofs", "Show roofs", B.showRoofs, "roofs", "Roofs are lifted away so you can reach inside. Show them to select one."));
        facts();
        const q = quantities();
        if (q.pieces) g.push(G_.info("Everything built", quantText(q)));
      }
    } else if (t === "room" || t === "tower") {
      g.push(G_.tiles("shape", "Shape", [{ v: "room", name: "Box", icon: "s-box" }, { v: "tower", name: "Round", icon: "s-round" }], t, "R"));
      if (t === "tower") g.push(G_.chips("levels", "Storeys", [1, 2, 3, 4].map((v) => ({ v, name: String(v) })), B.levels, "Shift wheel"));
      g.push(G_.sw("wmat", "Walls", SW.wall, B.wmat, "M"));
      g.push(G_.sw("fmat", "Floor", SW.floor, B.fmat));
      g.push(...PAINT());
      ceil();
      lift();
      t === "room" && wing();
      t === "room" && makeUp(g, "", B.found, B.ins, B.lining, B.deco);
    } else if (t === "wall") {
      g.push(G_.tiles("style", "Style", tiles(STYLE_SHORT, "w-"), B.style, "Shift wheel"));
      g.push(G_.sw("wmat", "Material", SW.wall, B.wmat, "M"));
      g.push(...PAINT());
      ceil("Height");
      lift();
      wing();
    } else if (t === "floor") {
      g.push(G_.sw("fmat", "Surface", SW.floor, B.fmat, "M"));
      g.push(...PAINT());
      lift();
      wing();
      makeUp(g, "", B.found, B.ins, B.lining, B.deco);
    } else if (t === "roof") {
      g.push(G_.tiles("rshape", "Shape", tiles(ROOF_SHAPES, "r-"), B.rsh, "Shift wheel"));
      if (TURNS[B.rsh]) g.push(G_.act("rturn", "Turn", "turn"));
      roofSwatches(g, "rmat", B.rmat, "M");
      g.push(...PAINT());
      g.push({ ...G_.act("roofall", "Roof the building", "roofs", "Enter"), title: "Cover every floor of the building under the cursor: one roof per rectangle, with this shape's pitch, roofing and overhangs" });
      facts();
      const hov = B.op && B.op.addRoofs && B.op.addRoofs[0];
      roofPlanView(g, "", { shape: B.rsh, pitch12: B.pitch12, eave: B.eave, rake: B.rake, gutters: B.gutters, color: B.rcolor, mat: B.rmat }, hov || null);
      g.push(G_.tiles("tshape", "On a round room", tiles(TOP_SHORT, "t-"), B.tshape));
    } else if (t === "door" || t === "window") openingView(g);
    else if (t === "stairs") g.push(G_.act("turn", "Turn", "turn", "Shift wheel"));
    else if (t === "pillar") {
      g.push(G_.tiles("pkind", "Kind", [{ v: "pillar", name: "Pillar", icon: "p-pillar" }, { v: "chimney", name: "Chimney", icon: "p-chimney" }], B.pkind, "Shift wheel"));
      g.push(G_.sw("wmat", "Material", SW.wall, B.wmat, "M"));
      g.push(...PAINT());
      g.push(G_.chips("gap", "In a row, one every", gapItems(), B.gap));
      lift();
    } else if (t === "path") {
      g.push(G_.chips("pwidth", "Width", [1, 2, 3].map((v) => ({ v, name: v + " m" })), B.pwidth, "Shift wheel"));
      g.push(G_.sw("pmat", "Surface", SW.path, B.pmat, "M"));
      g.push(...PAINT());
    } else if (t === "decor") {
      const cat = DECOR[B.dkind].cat;
      g.push(G_.chips("dcat", "", DCATS.map((name, n) => ({ v: n, name })), cat));
      g.push(G_.sw("dcol", "Colour", SW.dye, B.dcol, "M"));
      g.push(G_.act("turn", "Turn " + B.drot * 45 + "°", "turn", "Shift wheel"));
      g.push(...PAINT());
      g.push({ ...G_.chips("dkind", "", DKEYS.filter((k) => DECOR[k].cat === cat).map((k) => ({ v: k, name: DECOR[k].name })), B.dkind), row: 2 });
    } else if (t === "equip") fxView(g);
    else if (t === "measure") {
      if (B.meas.length) {
        const m = measText(B.meas[B.meas.length - 1].a, B.meas[B.meas.length - 1].b);
        g.push(G_.info("Last measured", fmtM(m.len) + " across · " + (Math.abs(m.rise) > 0.02 ? (m.rise > 0 ? "up " : "down ") + fmtM(Math.abs(m.rise)) : "level") + " · " + Math.round(m.angle) + "° from the grid" + (Math.abs(m.rise) > 0.02 ? " · " + fmtM(m.direct) + " direct" : "")));
        g.push(G_.act("mclear", "Clear all", "bin"));
      }
    } else if (t === "copy") g.push(G_.act("turn", "Turn", "turn", "Shift wheel"));
    const busy = B.move ? "move" : B.drag && B.drag.mode === "click" ? "chain" : B.tapMode ? B.tapMode : B.measA ? "measure" : t === "copy" ? "copy" : "";
    const oneRoof = t === "select" && B.sel.length === 1 && (selRefs()[0] || {}).kind === "roof";
    tierOf(t, g);
    prefsLoad();
    // the inspector's groups are listed only while it is open (row "d" keeps the old interface's side panel working)
    const insp = inspectorOf(t, g),
      shown = insp.open ? g.map((x) => (x.tier ? x : ((x.row = "d"), x))) : g.filter((x) => x.tier);
    return { inspector: insp, levels: levelChips(), coach: B.coached ? null : coachSteps(), total: planTotal(), fit: B.fit || null, roofs: !!B.showRoofs, sandbox: sandboxOn(), designTitle: (t === "window" || t === "door") && freeTool() ? (B.fsel ? "Editing the selected " + t : "Designing the next " + t) : t === "roof" ? "Planning the next roof" : oneRoof ? "The selected roof" : insp.title, tool: t, top: t === "tower" ? "room" : t === "copy" ? "select" : t, tools: TOOLS, groups: shown, hint: B.hintText, undo: B.undo.length, redo: B.redo.length, snap: B.snap, free: B.free, level: B.level, levelName: LEVEL_NAME(B.level), busy, sel: B.sel.length, fold: B.fold, sched: B.sched ? schedule() : null };
  }
  // ---- a door or window in the view: the gaps either side of it, its sizes, and handles on its edges to resize it
  // the clear gaps from a unit to what stands either side of it along its wall (or the wall's end), as live sizes
  function gapsBeside(S, run, f, sp) {
    const ax = runAx(S, run),
      os = runOthers(S, run, f.id),
      a = f.pos - ax.t0,
      b = a + sp.w,
      door = sp.type.kind === "door",
      yMid = (door ? 0 : sp.sill) + sp.h / 2,
      at = (u, y, text) => {
        const p = P3(ax.F0, ax.t0 + u, 0, 0);
        return { lx: p[0], lz: p[2], y, text };
      },
      out = [];
    let l = 0,
      r = ax.t1 - ax.t0;
    for (const q of os) {
      if (q.b <= a + 1e-6) l = Math.max(l, q.b - OP.ROUGH_GAP);
      if (q.a >= b - 1e-6) r = Math.min(r, q.a + OP.ROUGH_GAP);
    }
    a - l > 0.05 && out.push(at((l + a) / 2, yMid, "← " + fmt(a - l) + " m"));
    r - b > 0.05 && out.push(at((b + r) / 2, yMid, fmt(r - b) + " m →"));
    door || out.push(at((a + b) / 2, sp.sill / 2, "sill " + fmt(sp.sill) + " m"));
    return out;
  }
  // the selected unit's sizes: width and height you can type into, its sill and the gaps beside it
  function selDims() {
    if (!freeTool() || !B.fsel || B.drag) return [];
    const q = fselOpen();
    if (!q) return [];
    const { S, f, sp, g: run } = q,
      door = sp.type.kind === "door",
      y0 = door ? 0 : sp.sill,
      P = (u, y) => {
        const p = P3(fF(f), u, 0, 0),
          [x, z] = toWorld(S, p[0], p[2]);
        return { x, y: S.y0 + y, z };
      },
      lw = sp.leaf ? sp.leaf.b - sp.leaf.a : sp.w,
      lh = sp.leaf ? sp.leaf.h : sp.h;
    const out = [
      { ...P(sp.w / 2, y0 + sp.h + 0.18), field: "a", val: lw, unit: "m wide" },
      { ...P(sp.w + 0.05, y0 + sp.h / 2), field: "b", val: lh, unit: "m high" },
    ];
    if (run)
      for (const g of gapsBeside(S, run, f, sp)) {
        const [x, z] = toWorld(S, g.lx, g.lz);
        out.push({ x, y: S.y0 + g.y, z, text: g.text });
      }
    return out;
  }
  // the handles: left and right edges, the head, and (windows) the sill
  function oHandles() {
    if (!freeTool() || !B.fsel || (B.drag && !B.ores)) return [];
    const q = fselOpen();
    if (!q) return [];
    const { S, f, sp } = q,
      y0 = sp.type.kind === "door" ? 0 : sp.sill,
      y1 = y0 + sp.h,
      ym = (y0 + y1) / 2,
      P = (u, y, k) => {
        const p = P3(fF(f), u, 0, 0),
          [x, z] = toWorld(S, p[0], p[2]);
        return [x, S.y0 + y, z, k, k === "t" || k === "b" ? "ns" : "ew"];
      };
    const out = [P(0, ym, "l"), P(sp.w, ym, "r"), P(sp.w / 2, y1, "t")];
    sp.type.kind === "door" || out.push(P(sp.w / 2, y0, "b"));
    return out;
  }
  function ohTick() {
    const hs = freeTool() && B.fsel ? oHandles() : [],
      key = hs.map((p) => p.slice(0, 3).map((v) => v.toFixed(3)).join()).join("|");
    if (key === B.ohKey) return;
    if (!hs.length && !B.ohKey) return;
    B.ohKey = key;
    if (B.tool !== "select" || (B.ov.handles[0] && B.ov.handles[0][4])) B.ov.handles = hs;
    B.ovVer++;
  }
  // drag an edge: the opposite edge stays put; 5 cm steps, the store's sizes pull, the wall's ends, its neighbours
  // and its top plate stop it. Ctrl drags free.
  function resizeBegin(k) {
    const q = fselOpen();
    if (!q) return false;
    pushUndo();
    const { f, sp } = q,
      y0 = sp.type.kind === "door" ? 0 : sp.sill;
    B.ores = { k, id: f.id, u0: f.pos, u1: f.pos + sp.w, y0, y1: y0 + sp.h, t: 0 };
    hint();
    return true;
  }
  function resizeMove() {
    const R = B.ores,
      q = fselOpen();
    if (!q || q.f.id !== R.id) return void (B.ores = null);
    const { S, f, sp, g: run } = q,
      t = sp.type,
      door = t.kind === "door",
      ax = run ? runAx(S, run) : null,
      p = ax ? wallPtF(S, ax.F0) : null;
    if (!p || !run) return;
    const snapping = snapOn() && !B.ctrl,
      st = (v) => (snapping ? Math.round(v * 20) / 20 : Math.round(v * 100) / 100),
      ew = sp.leaf ? sp.w - (sp.leaf.b - sp.leaf.a) : 0,
      eh = sp.leaf ? sp.h - sp.leaf.h : 0,
      Hh = EAVE * S.hs,
      os = runOthers(S, run, f.id);
    // how far each edge may go
    let lo = ax.t0 + OP.END_GAP + OP.ROUGH_GAP,
      hi = ax.t1 - OP.END_GAP - OP.ROUGH_GAP;
    for (const o of os) {
      if (o.b <= R.u0 - ax.t0 + 1e-6) lo = Math.max(lo, ax.t0 + o.b + OP.OPEN_GAP + OP.ROUGH_GAP);
      if (o.a >= R.u1 - ax.t0 - 1e-6) hi = Math.min(hi, ax.t0 + o.a - OP.OPEN_GAP - OP.ROUGH_GAP);
    }
    const top = Hh - 0.19 - OP.ROUGH_GAP - (door ? 0.04 : 0),
      [w0, w1] = [t.range.w[0] + ew, t.range.w[1] + ew],
      [h0, h1] = [t.range.h[0] + eh, t.range.h[1] + eh],
      stdW = t.w.map((x) => x + ew),
      stdH = t.h.map((x) => x + eh),
      pull = (v, list) => {
        if (!snapping) return [v, false];
        for (const x of list) if (Math.abs(x - v) < 0.035) return [x, true];
        return [v, false];
      };
    let { u0, u1, y0, y1 } = R,
      std = false,
      lim = "";
    if (R.k === "l" || R.k === "r") {
      let W = R.k === "l" ? u1 - st(p.u) : st(p.u) - u0;
      [W, std] = pull(W, stdW);
      W = clamp(W, w0, w1);
      if (R.k === "l") ((u0 = u1 - W), u0 < lo && ((u0 = lo), (lim = "the next opening or the wall's end"))), (W = u1 - u0);
      else ((u1 = u0 + W), u1 > hi && ((u1 = hi), (lim = "the next opening or the wall's end")));
    } else if (R.k === "t") {
      let H = st(p.y) - y0;
      [H, std] = pull(H, stdH);
      H = clamp(H, h0, h1);
      y1 = y0 + H;
      if (y1 > top) ((y1 = top), (lim = "the top plate"));
    } else {
      let H = y1 - st(p.y);
      [H, std] = pull(H, stdH);
      H = clamp(H, h0, h1);
      y0 = y1 - H;
      if (y0 < 0.1) ((y0 = 0.1), (lim = "the floor"));
    }
    const nw = Math.round((u1 - u0 - ew) * 1000) / 1000,
      nh = Math.round((y1 - y0 - eh) * 1000) / 1000;
    if (nw < t.range.w[0] - 1e-6 || nh < t.range.h[0] - 1e-6) return;
    const changed = Math.abs((f.w || 0) - nw) > 1e-4 || Math.abs((f.h || 0) - nh) > 1e-4 || Math.abs(f.pos - u0) > 1e-4 || (!door && Math.abs(f.sill - y0) > 1e-4);
    R.note = (std ? "A store size" : "Made to order") + (lim ? " · stopped by " + lim : "");
    if (!changed) return;
    f.w = nw;
    f.h = nh;
    f.pos = Math.round(u0 * 1000) / 1000;
    if (!door) f.sill = Math.round(y0 * 1000) / 1000;
    S.ver++;
    const now = performance.now();
    if (now - R.t > 45) ((R.t = now), rebuild(S));
    else R.dirty = true;
    label(fmtM(nw) + " × " + fmtM(nh) + " · " + R.note, false);
    touchUi();
  }
  function resizeEnd() {
    const R = B.ores;
    B.ores = null;
    const q = fselOpen();
    if (q && R) (rebuild(q.S), saveBuilds());
    hint();
    touchUi();
  }
  // a width or height typed on the selected unit
  function typedSize() {
    const q = fselOpen();
    if (!q || (B.typed.a === null && B.typed.b === null)) return;
    const a = B.typed.a,
      b = B.typed.b;
    typedClear();
    if (a !== null) designChoose("w:w", a);
    if (b !== null) designChoose("w:h", b);
  }
  // the Window and Door tools place catalog units, unless a rustic module style is in hand
  const freeTool = () => (B.tool === "window" && !B.wleg) || (B.tool === "door" && !B.dleg);
  // the Window and Door tools: a strip of types and sizes, sill presets, and what the chosen unit needs
  const fselOpen = () => {
    for (const S of B.structs) {
      const o = S.fopen.find((q) => q.f.id === B.fsel);
      if (o) return { S, ...o };
    }
    return null;
  };
  // what the designer carries onto a window: a made-to-order size, a frame colour and a look (from B.od, or from f)
  function designOf(f) {
    const o = f || B.od,
      out = {};
    if (o.w > 0 && o.h > 0) ((out.w = o.w), (out.h = o.h));
    if (o.finish) out.finish = o.finish;
    if (o.look && Object.keys(o.look).length) out.look = { ...o.look };
    return out;
  }
  const MODERN_W = new Set(["full_panel", "window_wall", "slot", "ribbon", "tilt_turn"]);
  const finHex = (k) => "#" + OP.FINISHES[k].hex.toString(16).padStart(6, "0");
  const money = (v) => "$" + Math.round(v).toLocaleString("en-US");
  function openingView(g) {
    const win = B.tool === "window",
      leg = win ? B.wleg : B.dleg,
      sel = !leg && B.fsel ? fselOpen() : null,
      typeId = sel ? sel.f.typeId : B.otype,
      t = OP.openingType(typeId),
      kinds = OP.OPENING_TYPES.filter((x) => x.kind === (win ? "window" : "door")),
      tilesOf = (list) => list.map((x) => ({ v: x.id, name: x.name, icon: "o-" + x.id })),
      cur = (list, v) => (list.some((x) => x.v === v) ? v : undefined),
      groups = win
        ? [["Classic", tilesOf(kinds.filter((x) => !MODERN_W.has(x.id)))], ["Modern", tilesOf(kinds.filter((x) => MODERN_W.has(x.id)))], ["Rustic", Object.keys(WIN_SHORT).map((k) => ({ v: "m:" + k, name: WIN_NAME[k] + " (rustic, fits angled walls)", icon: "n-" + k }))]]
        : [["Hinged", tilesOf(kinds.filter((x) => OP.designable(x)))], ["Sliding and folding", tilesOf(kinds.filter((x) => !OP.designable(x)))], ["Rustic", Object.keys(DOOR_SHORT).map((k) => ({ v: "m:" + k, name: DOOR_NAME[k] + " (rustic, fits angled walls)", icon: "d-" + k }))]];
    const pick = leg ? "m:" + (win ? B.wstyle : B.dstyle) : typeId;
    for (const [name, items] of groups) g.push(G_.tiles("otype", name, items, cur(items, pick), name === groups[0][0] ? "Shift wheel" : undefined));
    if (leg) {
      g.push(G_.chips("gap", "In a row, one every", gapItems(), B.gap));
      g.push(...PAINT().slice(1));
      return;
    }
    const sp = sel ? sel.sp : OP.freeSpec({ typeId, sizeIdx: B.osize, sill: OP.sillFor(typeId, B.osill), ...designOf(), ...nextDesign() }),
      hd = sp.header,
      it = G.stock && G.stock.ITEMS ? G.stock.ITEMS[sp.itemId] : null,
      mto = !!(it && it.madeToOrder);
    g.push(G_.info((sel ? "Selected: " : "Next: ") + sp.type.name, sp.type.blurb || OP.OPERATION[sp.type.op]));
    g.push({
      type: "badges",
      id: "o:badges",
      items: [
        it ? { text: money(it.priceUsd), k: "price", title: it.name } : null,
        { text: mto ? "Made to order" : "Store size", k: mto ? "mto" : "std", title: mto ? "Not a stock size: a fifth dearer" : "Sold off the shelf" },
        { text: OP.OPERATION[sp.type.op], title: "How it opens" },
        { text: "Header " + (hd.engineered ? "glulam" : hd.plies + "×" + hd.size), title: "Rough opening " + fmtM(sp.rough.width) + " × " + fmtM(sp.rough.height) + (hd.engineered ? ", a glulam beam on double jacks" : ", " + hd.plies + " boards of " + hd.size.replace("x", " x ") + " on edge") },
        B.wnote ? { text: B.wnote, k: "bad" } : null,
        B.dnote ? { text: "Won't fit: " + B.dnote, k: "bad" } : null,
      ].filter(Boolean),
    });
    g.push(G_.act("oflip", sel ? "Flip" : B.oflip ? "Flipped" : "Flip", "turn", "F"));
    sel && g.push(G_.act("odel", "Delete", "bin", "Del", true));
    // the designer, on the second row: the size, then the look
    const row = (x, sec) => ((x.row = "d"), sec && (x.sec = sec), g.push(x)),
      bw = sp.leaf ? sp.leaf.b - sp.leaf.a : sp.w,
      bh = sp.leaf ? sp.leaf.h : sp.h,
      rg = sp.type.range;
    if (win) row({ type: "winprev", id: "w:prev", label: "", w: sp.w, h: sp.h, sill: sp.sill, wallH: EAVE, look: sp.look, finish: finHex(sp.finish), op: sp.type.op });
    row({ type: "num", id: "w:w", label: "Width", value: fmt(bw), unit: "m", note: fmt(rg.w[0]) + "–" + fmt(rg.w[1]) }, "Size");
    row({ type: "num", id: "w:h", label: "Height", value: fmt(bh), unit: "m", note: fmt(rg.h[0]) + "–" + fmt(rg.h[1]) }, "Size");
    if (win) row({ type: "num", id: "w:sill", label: "Sill", value: fmt(sp.sill), unit: "m", note: "above the floor" }, "Size");
    const stdN = OP.openingSizes(typeId),
      stdAt = stdN.findIndex((z) => Math.abs(z.w - bw) < 1e-3 && Math.abs(z.h - bh) < 1e-3);
    row(G_.chips("osize", "Store sizes", stdN.map((z, n) => ({ v: n, name: fmt(z.w) + " × " + fmt(z.h) })), stdAt), "Size");
    if (win) {
      const L = sp.look,
        lookNow = Object.keys(OP.LOOKS).find((k) => {
          const o = OP.LOOKS[k];
          return o.grille === L.grille && o.finish === sp.finish && (o.grille === "none" || o.grille === "prairie" || (o.grid[0] === L.grid[0] && o.grid[1] === L.grid[1]));
        });
      row(G_.chips("w:look", "Whole look", Object.keys(OP.LOOKS).map((k) => ({ v: k, name: OP.LOOKS[k].name })), lookNow || null), "Style");
      row(G_.tiles("w:shape", "Shape", Object.keys(OP.SHAPES).map((k) => ({ v: k, name: OP.SHAPES[k] + (k !== "rect" && sp.type.op !== "fixed" ? " (does not open)" : ""), icon: "sh-" + k })), L.shape || "rect"), "Style");
      row(G_.tiles("w:grille", "Grille", Object.keys(OP.GRILLES).map((k) => ({ v: k, name: OP.GRILLES[k], icon: "gr-" + k })), L.grille), "Glass");
      if (/colonial|cottage|craftsman|diamond|sunburst/.test(L.grille)) {
        row(G_.step("w:gx", L.grille === "sunburst" ? "Rays" : "Bars across", String(L.grid[0])), "Glass");
        L.grille === "sunburst" || row(G_.step("w:gy", "Bars down", String(L.grid[1])), "Glass");
      }
      row(G_.step("w:lx", "Panes across", String(L.lites[0])), "Glass");
      row(G_.step("w:ly", "Panes high", String(L.lites[1])), "Glass");
      row(G_.sw("w:finish", "Frame", Object.keys(OP.FINISHES).map((k) => ({ v: k, name: OP.FINISHES[k].name, sw: ["flat", finHex(k), finHex(k)] })), sp.finish), "Frame");
    } else {
      const n0 = g.length;
      doorDesignerView(g);
      const SEC = { "d:face": "Face", "d:glass": "Face", "d:bars": "Face", "d:side": "Around it", "d:transom": "Around it", "d:fin": "Finish", "d:hw": "Finish", "d:metal": "Finish", "d:reset": "Finish" };
      for (let n = n0; n < g.length; n++) ((g[n].row = "d"), SEC[g[n].id] && (g[n].sec = SEC[g[n].id]));
    }
  }
  // apply a designer change to the selected window, or to the next one
  function designSet(fn) {
    const q = B.fsel ? fselOpen() : null;
    B.wnote = "";
    if (q) {
      // try it on a copy first: a window that grows taller drops its sill to fit, one that cannot fit is left as it was
      const f2 = { ...q.f, look: { ...(q.f.look || {}) } };
      fn(f2, q.sp);
      const sp2 = OP.freeSpec(f2);
      if (sp2.type.kind === "window") {
        const hi = EAVE * q.S.hs - 0.19 - sp2.h - OP.ROUGH_GAP;
        if (f2.sill > hi) f2.sill = Math.round(Math.max(0.1, hi) * 1000) / 1000;
      }
      const fit = doorFits(q, f2);
      if (!fit.ok) return void ((B.wnote = "Won't fit: " + fit.why.toLowerCase()), (B.key = ""), touchUi());
      return selFree((f) => {
        for (const k of Object.keys(f)) k in f2 || delete f[k];
        Object.assign(f, f2);
        f.pos = fit.pos;
      });
    }
    const sp = OP.freeSpec({ typeId: B.otype, sizeIdx: B.osize, sill: OP.sillFor(B.otype, B.osill), ...designOf(), ...nextDesign() });
    B.od.look = { ...(B.od.look || {}) };
    fn(B.od, sp);
    B.key = "";
    touchUi();
  }
  function designChoose(id, v) {
    const k = id.slice(2),
      st = (a, d, lo, hi) => Math.max(lo, Math.min(hi, (a | 0) + d));
    designSet((o, sp) => {
      const L = sp.look;
      const bw = sp.leaf ? sp.leaf.b - sp.leaf.a : sp.w,
        bh = sp.leaf ? sp.leaf.h : sp.h;
      if (v && typeof v === "object" && v.step !== undefined) v = (k === "w" ? bw : k === "h" ? bh : sp.sill) + 0.05 * v.step;
      if (k === "w" || k === "h") {
        const z = OP.fitSize(sp.type, k === "w" ? v : bw, k === "h" ? v : bh);
        o.w = z.w;
        o.h = z.h;
      } else if (k === "sill") {
        const y = Math.round(Math.max(0.05, Math.min(EAVE - 0.4, v)) * 100) / 100;
        if (o === B.od) B.osill = y;
        else o.sill = y;
      } else if (k === "look") {
        const P = OP.LOOKS[v];
        o.finish = P.finish;
        Object.assign(o.look, { grille: P.grille, grid: P.grid.slice(), slim: v === "modern" ? true : sp.type.look.slim || false });
      } else if (k === "shape") o.look.shape = v;
      else if (k === "lx") o.look.lites = [st(L.lites[0], v, 1, 12), L.lites[1]];
      else if (k === "ly") o.look.lites = [L.lites[0], st(L.lites[1], v, 1, 6)];
      else if (k === "grille") o.look.grille = v;
      else if (k === "gx") o.look.grid = [st(L.grid[0], v, 1, 8), L.grid[1]];
      else if (k === "gy") o.look.grid = [L.grid[0], st(L.grid[1], v, 1, 12)];
      else if (k === "finish") o.finish = v;
    });
  }
  // ---- the door designer (OP.designable doors): panels, glass, sidelights, transom, colour and handle. With a placed
  // door selected it edits that door (undoable); otherwise it shapes the next one. Choices live in f.look and f.finish.
  const DOOR_FIN = ["white", "cream", "black", "charcoal", "sage", "green", "blue", "red", "mustard", "oak", "wood", "walnut"];
  const nextDesign = () => {
    if (!OP.designable(OP.openingType(B.otype))) return {};
    const o = {};
    if (Object.keys(B.dlook).length) o.look = { ...B.dlook };
    if (B.dfin) o.finish = B.dfin;
    return o;
  };
  const keepDesign = (f) => {
    const o = {};
    for (const k of ["look", "finish", "w", "h"]) if (f[k] !== undefined) o[k] = f[k];
    return o;
  };
  function doorDesignerView(g) {
    const sel = B.fsel ? fselOpen() : null,
      t = OP.openingType(sel ? sel.f.typeId : B.otype);
    if (!OP.designable(t)) return;
    const K = sel ? sel.sp.look : OP.lookOf(t, { look: B.dlook }),
      fin = sel ? sel.sp.finish : B.dfin || t.finish,
      own = sel ? !!(sel.f.look || sel.f.finish) : !!(Object.keys(B.dlook).length || B.dfin);
    g.push(G_.tiles("d:face", "Panels", Object.keys(OP.DOOR_FACES).map((k) => ({ v: k, name: OP.DOOR_FACES[k], icon: "df-" + k })), K.face));
    g.push(G_.tiles("d:glass", "Glass", Object.keys(OP.DOOR_GLASS).map((k) => ({ v: k, name: OP.DOOR_GLASS[k], icon: "dg-" + k })), K.glass));
    if (K.glass !== "none" && K.glass !== "craft" && K.glass !== "slot") g.push(G_.toggle("d:bars", "Bars", !!K.bars, "dg-bars", "Divide the glass into small lites with muntins"));
    g.push(G_.chips("d:side", "Sidelights", Object.keys(OP.DOOR_SIDES).map((k) => ({ v: k, name: OP.DOOR_SIDES[k], note: k === "none" ? "" : "+" + fmtM(OP.SIDE_W * (k === "both" ? 2 : 1)) + " wide" })), K.side));
    g.push(G_.toggle("d:transom", "Transom", !!K.transom, "dg-transom", "A glass lite over the door, inside the same rough opening (+" + fmtM(OP.TRANSOM_H) + ")"));
    g.push(G_.sw("d:fin", "Colour", DOOR_FIN.filter((k) => OP.FINISHES[k]).map((k) => ({ v: k, name: OP.FINISHES[k].name, sw: [k === "oak" || k === "wood" || k === "walnut" ? "planks" : "plain", "#" + OP.FINISHES[k].hex.toString(16).padStart(6, "0"), "#" + new T.Color(OP.FINISHES[k].hex).multiplyScalar(0.7).getHexString()] })), fin));
    g.push(G_.chips("d:hw", "Handle", Object.keys(OP.DOOR_HW).map((k) => ({ v: k, name: OP.DOOR_HW[k] })), K.hw));
    g.push(G_.sw("d:metal", "Metal", Object.keys(OP.DOOR_METALS).map((k) => ({ v: k, name: OP.DOOR_METALS[k].name, sw: ["plain", "#" + OP.DOOR_METALS[k].hex.toString(16).padStart(6, "0"), "#000000"] })), K.metal));
    own && g.push(G_.act("d:reset", "As sold", "turn", "", false));
  }
  // a selected door grown by sidelights or a transom must still fit its wall: it grows about its centre
  function doorFits(q, f2) {
    const sp = OP.freeSpec(f2),
      run = q.g,
      ax = runAx(q.S, run),
      L = ax.t1 - ax.t0,
      c = q.f.pos + q.sp.w / 2 - ax.t0,
      sn = OP.snapFree({ L, at: c, w: sp.w, h: sp.h, sill: 0, others: runOthers(q.S, run, q.f.id), snap: false, wantSill: false });
    if (!sn.ok) return { ok: false, why: sn.reason };
    if (sp.rough.sill + sp.rough.height + 0.19 > EAVE * q.S.hs) return { ok: false, why: "Too tall for this wall" };
    return { ok: true, pos: ax.t0 + sn.offset };
  }
  function doorChoose(k, v) {
    const q = B.fsel ? fselOpen() : null;
    B.dnote = "";
    if (q && !OP.designable(q.sp.type)) return;
    if (!q && !OP.designable(OP.openingType(B.otype))) return;
    if (k === "reset") {
      if (q) {
        const f2 = { ...q.f, look: undefined, finish: undefined },
          fit = doorFits(q, f2);
        if (!fit.ok) return void (B.dnote = fit.why);
        selFree((f) => (delete f.look, delete f.finish, (f.pos = fit.pos)));
      } else ((B.dlook = {}), (B.dfin = null));
    } else if (k === "fin") q ? selFree((f) => (f.finish = v)) : (B.dfin = v);
    else {
      const cur = q ? q.sp.look : OP.lookOf(OP.openingType(B.otype), { look: B.dlook }),
        val = k === "bars" || k === "transom" ? !cur[k] : v;
      if (q) {
        const look = { ...(q.f.look || {}), [k]: val },
          fit = k === "side" || k === "transom" ? doorFits(q, { ...q.f, look }) : { ok: true, pos: q.f.pos };
        if (!fit.ok) return void ((B.dnote = (k === "side" ? "Sidelights: " : "Transom: ") + fit.why.toLowerCase()), touchUi());
        selFree((f) => ((f.look = look), (f.pos = fit.pos)));
      } else B.dlook = { ...B.dlook, [k]: val };
    }
    B.key = "";
  }
  function selFree(fn) {
    const q = fselOpen();
    if (!q) return;
    pushUndo();
    fn(q.f);
    q.S.ver++;
    rebuild(q.S);
    saveBuilds();
    touchUi();
  }
  function flipFree() {
    if (B.fsel && fselOpen()) selFree((f) => (f.flip = !f.flip));
    else ((B.oflip = !B.oflip), (B.key = ""), touchUi());
  }
  function delFree() {
    const q = fselOpen();
    if (!q) return;
    selFree((f) => void (q.S.free = q.S.free.filter((x) => x !== f)));
    B.fsel = null;
    B.key = "";
    touchUi();
  }
  const flash = (text) => ((B.flash = { text, until: performance.now() + 3500 }), hint(), touchUi());
  // Roof the building: every floor of the structure under the cursor (or the selection) is split into rectangles, the
  // largest first, and each gets its own roof with the pitch, roofing and overhangs in hand. Where they meet, the
  // planes run into each other. One undo step.
  function roofBuilding() {
    const h = B.hover,
      S = h && h.F && !h.F.isNew ? h.F : B.sel.length ? (selRefs()[0] || {}).S : null;
    // rooms drawn with free walls that make a plain rectangle (the ready-made plans, say) count too
    const boxes = [];
    if (S && !S.po)
      S.polys.forEach((p, pi) => {
        const q = p.pts;
        if (q.length !== 4 || !q.every((a, n) => { const b = q[(n + 1) % 4]; return Math.abs(a[0] - b[0]) < 1e-6 !== Math.abs(a[1] - b[1]) < 1e-6; })) return;
        const xs = q.map((a) => a[0]),
          zs = q.map((a) => a[1]);
        boxes.push({ i0: Math.min(...xs), i1: Math.max(...xs) - 1, j0: Math.min(...zs), j1: Math.max(...zs) - 1, pi, roofed: p.roofed });
      });
    if (!S || S.po || (!S.floors.size && !boxes.length)) return flash("Point at a building with floors to roof it.");
    const left = new Set([...S.floors].filter((k) => {
        const [i, j] = parse(k);
        return !inRings(S, i + 0.5, j + 0.5);
      })),
      rects = [];
    while (left.size) {
      let best = null;
      for (const k of left) {
        const [i, j] = parse(k);
        let wMax = 0;
        while (left.has(ck(i + wMax, j))) wMax++;
        for (let w = wMax; w >= 1; w--) {
          let l = 1;
          for (;;) {
            let full = true;
            for (let a = 0; a < w && full; a++) full = left.has(ck(i + a, j + l));
            if (!full) break;
            l++;
          }
          const area = w * l,
            sq = Math.min(w, l) / Math.max(w, l);
          if (!best || area > best.area || (area === best.area && sq > best.sq)) best = { i0: i, i1: i + w - 1, j0: j, j1: j + l - 1, area, sq };
        }
      }
      for (let i = best.i0; i <= best.i1; i++) for (let j = best.j0; j <= best.j1; j++) left.delete(ck(i, j));
      rects.push(best);
    }
    rects.push(...boxes);
    const op = blankOp(S);
    for (const b of boxes) b.roofed && op.delPolyRoofs.push(b.pi);
    S.roofs.forEach((r, idx) => rects.some((q) => !(r.i1 < q.i0 || r.i0 > q.i1 || r.j1 < q.j0 || r.j0 > q.j1)) && op.delRoofs.push(idx));
    for (const q of rects) {
      const w = q.i1 - q.i0 + 1,
        l = q.j1 - q.j0 + 1,
        rect = { i0: q.i0, i1: q.i1, j0: q.j0, j1: q.j1 },
        hand = roofFromHand(rect);
      if (B.rsh !== "flat" && B.rsh !== "shed") {
        hand.shape = Math.min(w, l) >= 3 && Math.max(w, l) / Math.min(w, l) < 1.5 ? "hip" : "gable";
        hand.axis = w >= l ? "x" : "z";
        hand.dir = 0;
      }
      op.addRoofs.push(Object.assign(rect, hand));
    }
    op.replacing = op.delRoofs.length + op.delPolyRoofs.length > 0;
    finishOp(op);
    if (!op.valid) return flash(op.reason || "Nothing to roof here.");
    applyOp(op);
    flash("Roofed " + plural(rects.length, "part") + " of the building · " + ROOFS[B.rmat].name.toLowerCase() + " · " + p12Text(B.pitch12) + ". Ctrl+Z undoes it.");
  }
  // a roof's plan, on the roof in hand or ("s:") on the selected roofs
  const stepNum = (cur, v, step, lo, hi) => {
    const val = v && typeof v === "object" ? cur + v.step * step : +v;
    return clamp(Math.round(val * 100) / 100, lo, hi);
  };
  // pitch steps by whole inches, and by half inches below 3/12
  const pitchStep = (p, v) => {
    if (!(v && typeof v === "object")) return clamp(Math.round(+v * 4) / 4, 0.25, 24);
    const fine = p < 3 || (p === 3 && v.step < 0);
    return clamp(fine ? Math.round((p + v.step * 0.5) * 2) / 2 : Math.round(p + v.step), 0.5, 24);
  };
  function roofTurnSet(r, t) {
    const sh = r.shape || "gable",
      wide = r.i1 - r.i0 >= r.j1 - r.j0;
    if (sh === "shed") r.dir = t & 3;
    else if (RIDGED[sh]) ((r.axis = wide !== !!(t & 1) ? "x" : "z"), (r.dir = sh === "saltbox" ? (t >> 1) & 1 : 0));
    else r.dir = 0;
  }
  function roofChoose(id, v) {
    const sel = id.startsWith("s:"),
      key = sel ? id.slice(2) : id,
      pstep = (p) => pitchStep(p, v);
    if (!sel) {
      if (key === "rshape") ((B.rsh = v), (B.rturn = TURNS[v] ? B.rturn % TURNS[v] : 0));
      else if (key === "rturn") B.rturn = (B.rturn + 1) % (TURNS[B.rsh] || 1);
      else if (key === "pitch") B.pitch12 = v;
      else if (key === "pitchn") B.pitch12 = pstep(B.pitch12);
      else if (key === "eave") B.eave = stepNum(B.eave, v, 0.05, 0, 1.2);
      else if (key === "rake") B.rake = stepNum(B.rake, v, 0.05, 0, 0.9);
      else if (key === "gutters") B.gutters = !B.gutters;
      else if (key === "rcolor") B.rcolor = v;
      B.key = "";
      touchUi();
      return;
    }
    selEdit((q) => {
      if (q.kind !== "roof") return false;
      const r = q.r,
        p = pitchOf(r);
      if (key === "rshape") {
        const t = turnOfRoof(r);
        r.shape = v;
        if (v !== "flat") r.pitch12 = p < 1 && r.mat !== "membrane" ? B.pitch12 : p;
        delete r.pitch;
        roofTurnSet(r, TURNS[v] ? t % TURNS[v] : 0);
      } else if (key === "rturn") roofTurnSet(r, (turnOfRoof(r) + 1) % (TURNS[r.shape || "gable"] || 1));
      else if (key === "pitch") ((r.pitch12 = v), delete r.pitch);
      else if (key === "pitchn") ((r.pitch12 = pstep(p)), delete r.pitch);
      else if (key === "eave") r.eave = stepNum(eaveOf(r), v, 0.05, 0, 1.2);
      else if (key === "rake") r.rake = stepNum(rakeOf(r), v, 0.05, 0, 0.9);
      else if (key === "gutters") r.gutters = !r.gutters;
      else if (key === "rcolor") v ? (r.color = v) : delete r.color;
      return true;
    });
  }
  function choose(id, v) {
    if (id === "shape") return setTool(v);
    if (id === "roofall") return roofBuilding();
    if (/^(s:)?(rshape|rturn|pitch|pitchn|eave|rake|gutters|rcolor)$/.test(id)) return roofChoose(id, v);
    if (id.startsWith("fx:")) fxChoose(id, v);
    else if (id === "found" || id === "ins" || id === "lining") B[id] = v;
    else if (id === "deco" || id === "sheen" || id === "trim") B.deco = decoWith(B.deco, id, v);
    else if (id === "s:deco" || id === "s:sheen" || id === "s:trim") {
      const q = selRefs()[0];
      if (q) {
        pushUndo();
        const d = decoWith(q.S.deco, id.slice(2), v);
        for (const O of groupOf(q.S)) ((O.deco = d && JSON.parse(JSON.stringify(d))), O.ver++);
        for (const O of groupOf(q.S)) rebuild(O);
      }
    }
    else if (id === "sched") B.sched = !B.sched;
    else if (id === "s:found") {
      const q = selRefs()[0];
      q && setFound(q.S, v);
    } else if (id === "s:ins" || id === "s:lining") {
      const q = selRefs()[0];
      if (q) {
        pushUndo();
        for (const O of groupOf(q.S)) ((O[id.slice(2)] = v), O.ver++);
        for (const O of groupOf(q.S)) rebuild(O);
      }
    } else if (id === "wmat" || id === "fmat" || id === "rmat" || id === "pmat" || id === "dcol" || id === "style" || id === "wstyle" || id === "dstyle" || id === "pkind" || id === "pwidth" || id === "levels" || id === "tshape" || id === "gap" || id === "hs") B[id] = v;
    else if (id === "lift") B.lift = clamp(B.lift + v * 0.5, -3, 6);
    else if (id === "wing") B.wingNext = !B.wingNext;
    else if (id === "roofs") B.showRoofs = !B.showRoofs;
    else if (id === "paint") B.tapMode = B.tapMode === "paint" ? "" : "paint";
    else if (id === "pick") B.tapMode = B.tapMode === "pick" ? "" : "pick";
    else if (id === "otype" && typeof v === "string" && v.startsWith("m:")) {
      // a rustic module style: the old one-metre pieces, which also go in angled walls
      if (B.tool === "window") ((B.wstyle = v.slice(2)), (B.wleg = true));
      else ((B.dstyle = v.slice(2)), (B.dleg = true));
      B.fsel = null;
    } else if (id === "otype") {
      if (OP.openingType(v).kind === "window") ((B.owin = v), (B.wleg = false));
      else ((B.odoor = v), (B.dleg = false));
      if (B.fsel && fselOpen()) designSet((f) => ((f.typeId = v), (f.sizeIdx = Math.floor(OP.openingSizes(v).length / 2)), delete f.w, delete f.h, delete f.look, delete f.finish, (f.sill = OP.sillFor(v, "auto"))));
      else ((B.otype = v), (B.osize = Math.floor(OP.openingSizes(v).length / 2)), (B.osill = "auto"), (B.od = { w: null, h: null, finish: null, look: {} }), (B.dlook = {}), (B.dfin = null), (B.dnote = ""));
    } else if (id === "osize") {
      if (v < 0) return;
      if (B.fsel && fselOpen()) designSet((f) => ((f.sizeIdx = v), delete f.w, delete f.h));
      else ((B.osize = v), (B.od.w = B.od.h = null));
    } else if (id.startsWith("w:")) designChoose(id, v);
    else if (id.startsWith("d:")) doorChoose(id.slice(2), v);
    else if (id === "osill") {
      B.osill = v;
      B.fsel && selFree((f) => (f.sill = OP.sillFor(f.typeId, v)));
    } else if (id === "oflip") flipFree();
    else if (id === "odel") delFree();
    else if (id === "turn") cycleStyle(false);
    else if (id === "dcat") B.dkind = DKEYS.find((k) => DECOR[k].cat === v);
    else if (id === "dkind") B.dkind = v;
    else if (id === "mclear") measClear();
    else if (id === "s:wmat" || id === "s:fmat" || id === "s:rmat" || id === "s:pmat" || id === "s:dcol") selMaterial(id.slice(2), v);
    else if (id === "s:style") selStyle(v);
    else if (id === "s:otype") selOpenType(v);
    else if (id === "s:levels") selEdit((q) => q.kind === "ring" && ((q.r.h = v), true));
    else if (id === "s:top") selEdit((q) => q.kind === "ring" && ((q.r.roof = v || false), (q.r.rmat = q.r.rmat || B.rmat), true));
    else if (id === "s:pkind") selEdit((q) => q.kind === "pillar" && ((q.p[3] = v), true));
    else if (id === "s:pwidth") selEdit((q) => q.kind === "path" && ((q.p[4] = v), true));
    else if (id === "s:turn") selEdit((q) => q.kind === "decor" && ((q.it[3] = ((q.it[3] || 0) + 1) % 8), true));
    else if (id === "s:len" || id === "s:hs" || id === "s:x" || id === "s:z" || id === "s:width") selField(id.slice(2), +v);
    else if (id === "s:all") selBuilding();
    else if (id === "s:pick") pickUp(B.sel[0]);
    else if (id === "s:del") selDelete();
    else if (id === "s:dup") duplicate();
    else if (id === "snap") B.snap = !B.snap;
    else if (id === "fold") {
      B.fold = !B.fold;
      try {
        localStorage.setItem("build:fold", B.fold ? "1" : "");
      } catch {}
    } else if (id === "free") B.free = !B.free;
    else if (id === "level") return setLevel(B.level + v);
    else if (id === "level:set") return setLevel(+v);
    else if (id === "insp") {
      // the inspector: Door and Window (and a double click) open it for now; elsewhere it stays as the player left it
      prefsLoad();
      const now = B.inspNow !== null && B.inspNow !== undefined ? B.inspNow : B.insp;
      if (B.tool === "door" || B.tool === "window") B.inspNow = !now;
      else (prefSave("build:insp", (B.insp = !now)), (B.inspNow = null));
      B.uiVer++;
    }
    else if (id === "undo") return undo();
    else if (id === "redo") return redo();
    else if (id === "stop") putDown(false);
    else if (id === "done") return toggle();
    B.key = "";
    hint();
    touchUi();
  }
  // a copy of the selection in the hand: a whole building is stamped as a new one, parts are copied where they stand
  function duplicate() {
    const refs = selRefs();
    if (!refs.length) return;
    const sel = new Set(B.sel),
      S0 = refs[0].S,
      grp = groupOf(S0);
    if (!S0.po && refs.every((q) => grp.includes(q.S)) && grp.every((O) => elemIds(O).every((id) => sel.has(id)))) {
      B.tool = "copy";
      copyFrom(S0);
      return touchUi();
    }
    moveBegin(true, true, null);
  }
  // typed sizes while drawing: a for the first value (length or width), b for the second (angle or depth)
  function typedSet(a, b) {
    const n = (v) => (v === null || v === "" || !isFinite(+v) || +v <= 0 ? null : +v);
    B.typed.a = n(a);
    B.typed.b = b === null || b === "" || !isFinite(+b) ? null : B.tool === "wall" || B.tool === "path" ? clamp(Math.abs(+b), 0, 90) : n(b);
    B.key = "";
  }
  window.addEventListener("keyup", (e) => {
    if (e.code === "AltLeft" || e.code === "AltRight") ((B.alt = false), (B.key = ""));
    if (e.code === "KeyE" && B.on && B.eDown && performance.now() - B.eDown < 220 && !(e.target && e.target.tagName === "INPUT")) setTool("equip");
    if (e.code === "ControlLeft" || e.code === "ControlRight" || e.code === "MetaLeft" || e.code === "MetaRight") ((B.ctrl = B.ctrlWheel = false), (B.key = ""));
  });
  window.addEventListener("blur", () => (B.alt = B.ctrl = B.ctrlWheel = false));
  const TOOL_KEY = { KeyV: "select", KeyR: "room", KeyN: "wall", KeyF: "floor", KeyO: "roof", KeyJ: "door", KeyU: "window", KeyZ: "stairs", KeyP: "pillar", KeyL: "path", KeyC: "decor", KeyY: "measure", KeyX: "erase" };
  const TOOL_LETTER = {};
  for (const k in TOOL_KEY) TOOL_LETTER[TOOL_KEY[k]] = k.slice(3);
  TOOL_LETTER.equip = "E";
  function onKey(e) {
    if (e.code === "AltLeft" || e.code === "AltRight") ((B.alt = true), (B.key = ""));
    if (e.code === "ControlLeft" || e.code === "ControlRight" || e.code === "MetaLeft" || e.code === "MetaRight") ((B.ctrl = true), (B.key = ""));
    if (e.code === "KeyB" && !e.repeat && !(e.ctrlKey || e.metaKey)) return (toggle(), true);
    if (!B.on) return false;
    const cmd = e.ctrlKey || e.metaKey;
    if (cmd && e.code === "KeyZ") return (e.preventDefault(), e.shiftKey ? redo() : undo(), true);
    if (cmd && e.code === "KeyY") return (e.preventDefault(), redo(), true);
    if (cmd && e.code === "KeyD") return (e.preventDefault(), B.tool === "select" && duplicate(), true);
    if (cmd && e.code === "KeyA") return (e.preventDefault(), setTool("select"), selSet(B.structs.filter((S) => S.level === B.level).flatMap(elemIds)), true);
    if (cmd) return false;
    // while a stroke is in hand, digits are an exact size for it
    const digit = /^(Digit|Numpad)([0-9])$/.exec(e.code),
      sized = B.drag && (B.tool === "wall" || B.tool === "room" || B.tool === "floor" || B.tool === "path" || B.tool === "tower" || B.tool === "pillar");
    if (sized && (digit || e.code === "Period" || e.code === "NumpadDecimal" || e.code === "Tab" || e.code === "Comma")) {
      e.preventDefault();
      B.typeHook && B.typeHook(digit ? digit[2] : e.code === "Tab" || e.code === "Comma" ? "next" : ".");
      return true;
    }
    if (sized && e.code === "Enter") return (commit(), true);
    if (B.tool === "roof" && !B.drag && e.code === "Enter" && !e.repeat) return (roofBuilding(), true);
    if (e.code === "PageUp" || e.code === "BracketRight") return (e.preventDefault(), e.shiftKey ? cycleHeight(false) : setLevel(B.level + 1), true);
    if (e.code === "PageDown" || e.code === "BracketLeft") return (e.preventDefault(), e.shiftKey ? cycleHeight(true) : setLevel(B.level - 1), true);
    if (e.code === "Equal" || e.code === "Minus" || e.code === "NumpadAdd" || e.code === "NumpadSubtract") return (choose("lift", e.code === "Equal" || e.code === "NumpadAdd" ? 1 : -1), true);
    if (e.code === "Comma" || e.code === "Period") return (cycleStyle(e.code === "Comma"), true);
    if (e.code === "Slash" && !e.repeat) return (choose("snap"), true);
    if (e.code === "Backquote" && !e.repeat) return (choose("fold"), true);
    if (e.code === "KeyM" && !e.repeat) return (cycleMat(e.shiftKey), true);
    if (e.code === "KeyK" && !e.repeat) return (choose("paint"), true);
    if (e.code === "KeyI" && !e.repeat) return (B.tool === "select" && B.sel.length === 1 ? pickUp(B.sel[0]) : choose("pick"), true);
    if (e.code === "Escape") return (putDown(true) || toggle(), true);
    if (freeTool() && e.code === "KeyF" && !e.repeat) return (flipFree(), true);
    if (freeTool() && B.fsel && (e.code === "Delete" || e.code === "Backspace") && !e.repeat) return (delFree(), true);
    if ((e.code === "Delete" || e.code === "Backspace") && !e.repeat && B.tool === "equip" && FX.sel) return (choose("fx:del"), true);
    if ((e.code === "Delete" || e.code === "Backspace") && !e.repeat) return (B.tool === "select" && B.sel.length ? selDelete() : setTool("erase"), true);
    // E turns the view while it is held; a quick tap picks up the Equip tool
    if (e.code === "KeyE") return (e.repeat || (B.eDown = performance.now()), true);
    if (digit && !e.repeat) {
      const tl = TOOLS.find((x) => x.code === e.code);
      tl && setTool(tl.id);
      return true;
    }
    const id = !e.repeat && TOOL_KEY[e.code];
    if (id) {
      // a tool's letter picks it up; pressed again it steps through its styles
      const cur = B.tool === "tower" ? "room" : B.tool;
      if (cur !== id) setTool(id);
      else if (id === "room") setTool(B.tool === "room" ? "tower" : "room");
      else cycleStyle(e.shiftKey);
      return true;
    }
    return false;
  }

  /* ---------- hooks called by the engine ---------- */
  // A room with no door is a trap. Inside a building with no doorway at all, pushing into a wall for a moment climbs you
  // out over it (through the framing, or over the top with a hand up): never stuck, and never a way through a wall that
  // has a door to use instead.
  function hasWayOut(S) {
    if (S.wayVer === S.ver) return S.way;
    let way = S.fopen.some((o) => o.sp.type.kind === "door") || S.segs.some((sg) => isDoor(sg[4])) || S.rings.length > 0;
    if (!way) for (const t of S.walls.values()) if (isDoor(t)) ((way = true), 0);
    S.wayVer = S.ver;
    return (S.way = way);
  }
  function climbOut(e, S, px, pz) {
    const mv = Math.hypot(e.mvx || 0, e.mvz || 0),
      pushed = Math.hypot(px, pz);
    if (mv < 0.5 || pushed < 1e-4 || (px * e.mvx + pz * e.mvz) / (mv * pushed) > -0.3 || e.climbY != null) {
      e.__stuck = 0;
      return;
    }
    const now = performance.now();
    if (!e.__stuck || now - e.__stuckLast > 200) e.__stuck = now;
    e.__stuckLast = now;
    if (now - e.__stuck < 650) return;
    const [lx, lz] = toLocal(S, e.x, e.z);
    if (!onFloorAt(S, lx, lz) || hasWayOut(S)) return;
    // step out the way you are pushing until clear of the floor, then a little more
    const ux = e.mvx / mv,
      uz = e.mvz / mv;
    let k = 0.3;
    for (; k < 12; k += 0.15) {
      const [qx, qz] = toLocal(S, e.x + ux * k, e.z + uz * k);
      if (!onFloorAt(S, qx, qz)) break;
    }
    e.x += ux * (k + 0.55);
    e.z += uz * (k + 0.55);
    e.__bp = null;
    e.__stuck = 0;
    B.onClimbOut && B.onClimbOut(e);
  }
  function collideOnce(e, r, isPlayer, S) {
    let [lx, lz] = toLocal(S, e.x, e.z);
    const prev = e.__bp && e.__bp.id === S.id ? e.__bp : null;
    const ey = e.y === undefined ? 1e9 : e.y;
    const low = ey < S.y0 + FLOOR_T - 0.65;
    const R0 = r + HALF_T;
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
          if (ty && ((S.hid.size && S.hid.has(wk)) || (S.ghostW && S.ghostW.has(wk)) || (isPlayer && S.studW && S.studW.has(wk)))) continue;
          let block = blocks(ty, isPlayer, low);
          const R = R0;
          if (!block && !ty && low && !S.deckGhost) {
            const a = d === 0 ? S.floors.has(ck(i, j - 1)) : S.floors.has(ck(i - 1, j)),
              b = S.floors.has(ck(i, j));
            block = a !== b;
          }
          if (!block) continue;
          // u runs along the edge, w across it. A free door in a plain wall leaves the player a way through: the wall is
          // then only the stretches between the doors
          const spans = isPlayer && !low && ty === "wall" && S.doorGaps.get(wk) ? S.doorGaps.get(wk) : [[0, 1]];
          const u = d === 0 ? lx - i : lz - j,
            w = d === 0 ? lz - j : lx - i;
          for (const [s0, s1] of spans) {
          if (prev) {
            const pw = d === 0 ? prev.lz - j : prev.lx - i;
            if (pw * w < 0 && u > s0 - r && u < s1 + r && Math.abs(pw) > 1e-3) {
              const nw = Math.sign(pw) * R;
              d === 0 ? (lz = j + nw) : (lx = i + nw);
              moved = true;
              continue;
            }
          }
          const cu = clamp(u, s0, s1),
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
        }
    for (const sg of S.colSegs) {
      const ty = sg[4];
      if (!blocks(ty, isPlayer, low)) continue;
      if (isPlayer && S.studSegs && S.studSegs.size && S.studSegs.has(sg[0] + "," + sg[1] + "," + sg[2] + "," + sg[3])) continue;
      const R = R0;
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
  /* ---------- piece identity ---------- */
  // Every built element keeps one id for life: through edits, undo and saving, and whatever is built or removed
  // around it. Roofs, towers, stairs, pillars, paths and furniture carry theirs. Walls and floors are stored as
  // 1 m edges and tiles, so a wall piece is a straight run of edges of one kind and material and a floor piece is
  // a connected area of one surface. Each run or area keeps the id most of its parts already had; a part that is
  // split off gets a new one.
  const newPid = () => "p" + B.nextPid++;
  const pidNum = (id) => +String(id).slice(1) || 0;
  const wallClass = (t) => (t === "rail" || t === "railgate" ? "rail" : "wall");
  // straight runs of grid wall edges, in a fixed order
  function gridRuns(S) {
    const lines = new Map();
    for (const [k, type] of S.walls) {
      if (S.hid.has(k)) continue;
      const [i, j, d] = parse(k),
        lk = d + "|" + (d === 0 ? j : i);
      let L = lines.get(lk);
      if (!L) lines.set(lk, (L = []));
      L.push({ k, t: d === 0 ? i : j, i, j, d, type, cls: wallClass(type), mat: S.wmat.get(k) || "timber" });
    }
    const runs = [];
    for (const lk of [...lines.keys()].sort()) {
      let cur = null;
      for (const e of lines.get(lk).sort((p, q) => p.t - q.t)) {
        if (cur && e.t === cur.t1 && e.cls === cur.cls && e.mat === cur.mat) {
          cur.m.push(e);
          cur.t1 = e.t + 1;
        } else runs.push((cur = { d: e.d, line: e.d === 0 ? e.j : e.i, t0: e.t, t1: e.t + 1, cls: e.cls, mat: e.mat, m: [e] }));
      }
    }
    return runs;
  }
  // straight runs of free-angle wall pieces: pieces that meet end to end in one line, of one kind and material
  function freeRuns(S) {
    const segs = S.segs,
      par = segs.map((_, n) => n),
      find = (a) => {
        while (par[a] !== a) a = par[a] = par[par[a]];
        return a;
      },
      ends = new Map(),
      at = (x, z) => Math.round(x * 50) + "," + Math.round(z * 50),
      shown = segs.map((sg) => !(S.rings.length && inRings(S, (sg[0] + sg[2]) / 2, (sg[1] + sg[3]) / 2)));
    segs.forEach((sg, n) => {
      if (!shown[n]) return;
      for (const k of [at(sg[0], sg[1]), at(sg[2], sg[3])]) {
        let L = ends.get(k);
        if (!L) ends.set(k, (L = []));
        L.push(n);
      }
    });
    for (const L of ends.values())
      for (let a = 0; a < L.length; a++)
        for (let b = a + 1; b < L.length; b++) {
          const p = segs[L[a]],
            q = segs[L[b]];
          if (wallClass(p[4]) !== wallClass(q[4]) || (p[5] || "timber") !== (q[5] || "timber")) continue;
          const ux = p[2] - p[0],
            uz = p[3] - p[1],
            vx = q[2] - q[0],
            vz = q[3] - q[1];
          if (Math.abs(ux * vz - uz * vx) < 0.01 * Math.hypot(ux, uz) * Math.hypot(vx, vz)) par[find(L[a])] = find(L[b]);
        }
    const groups = new Map(),
      runs = [];
    segs.forEach((sg, n) => {
      if (!shown[n]) return;
      const r = find(n);
      let g = groups.get(r);
      if (!g) (groups.set(r, (g = { free: true, m: [] })), runs.push(g));
      g.m.push(n);
    });
    for (const g of runs) {
      const f = segs[g.m[0]],
        fl = Math.hypot(f[2] - f[0], f[3] - f[1]) || 1,
        ux = (f[2] - f[0]) / fl,
        uz = (f[3] - f[1]) / fl,
        tOf = (x, z) => (x - f[0]) * ux + (z - f[1]) * uz;
      let lo = 1e9,
        hi = -1e9;
      g.mods = g.m.map((n) => {
        const sg = segs[n],
          ta = tOf(sg[0], sg[1]),
          tb = tOf(sg[2], sg[3]);
        lo = Math.min(lo, ta, tb);
        hi = Math.max(hi, ta, tb);
        return { idx: n, s: Math.min(ta, tb), len: Math.abs(tb - ta), type: sg[4] };
      });
      g.mods.sort((p, q) => p.s - q.s);
      for (const q of g.mods) q.s -= lo;
      g.m = g.mods.map((q) => q.idx);
      g.cls = wallClass(f[4]);
      g.mat = f[5] || "timber";
      g.ux = ux;
      g.uz = uz;
      g.x0 = f[0] + ux * lo;
      g.z0 = f[1] + uz * lo;
      g.x1 = f[0] + ux * hi;
      g.z1 = f[1] + uz * hi;
      g.len = hi - lo;
    }
    return runs;
  }
  // connected areas of floor tiles of one surface (stairwells are not floor)
  function floorAreas(S) {
    const seen = new Set(),
      out = [],
      well = new Map(),
      isWell = (k) => {
        let w = well.get(k);
        if (w === undefined) {
          const [i, j] = parse(k);
          well.set(k, (w = wellOver(S, i, j)));
        }
        return w;
      };
    for (const k of S.floors) {
      if (seen.has(k) || isWell(k)) continue;
      const mat = S.fmat.get(k) || "planks",
        g = { mat, m: [], i0: 1e9, i1: -1e9, j0: 1e9, j1: -1e9 },
        stack = [k];
      seen.add(k);
      while (stack.length) {
        const c = stack.pop(),
          [i, j] = parse(c);
        g.m.push(c);
        g.i0 = Math.min(g.i0, i);
        g.i1 = Math.max(g.i1, i);
        g.j0 = Math.min(g.j0, j);
        g.j1 = Math.max(g.j1, j);
        for (const nk of [ck(i - 1, j), ck(i + 1, j), ck(i, j - 1), ck(i, j + 1)]) {
          if (seen.has(nk) || !S.floors.has(nk) || (S.fmat.get(nk) || "planks") !== mat || isWell(nk)) continue;
          seen.add(nk);
          stack.push(nk);
        }
      }
      g.m.sort();
      out.push(g);
    }
    return out;
  }
  // Each group takes the id most of its members already carry. Where two groups want the same id the larger
  // keeps it and the other is a new piece (g.from says which piece it was split from).
  function vote(groups, idOf, taken) {
    for (const g of groups) {
      const tally = new Map();
      g.want = null;
      g.votes = 0;
      for (const m of g.m) {
        const id = idOf(m);
        if (!id) continue;
        const n = (tally.get(id) || 0) + 1;
        tally.set(id, n);
        if (n > g.votes || (n === g.votes && pidNum(id) < pidNum(g.want))) ((g.want = id), (g.votes = n));
      }
    }
    const order = groups.map((_, n) => n).sort((a, b) => groups[b].votes - groups[a].votes || a - b);
    for (const n of order) {
      const g = groups[n];
      g.id = g.want && !taken.has(g.want) ? g.want : null;
      g.id && taken.add(g.id);
    }
    for (const g of groups) g.from = g.id ? null : g.want;
  }
  // a point inside a closed shape, to remember it by
  function insidePoint(p) {
    if (pip(p.pts, p.cx, p.cz)) return [p.cx, p.cz];
    const tris = T.ShapeUtils.triangulateShape(
      p.pts.map((q) => new T.Vector2(q[0], q[1])),
      [],
    );
    if (!tris.length) return [p.cx, p.cz];
    const t = tris[0].map((k) => p.pts[k]);
    return [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];
  }
  // Give every piece of a structure its id. Runs on every rebuild; it changes nothing that is already settled.
  function identify(S) {
    const re = S.fresh ? new Map() : null,
      claim = B.claim,
      taken = new Set();
    // an id of our own: a copy gets new ones throughout, and no two pieces in a loaded save may share one
    const own = (id) => {
      if (re) {
        if (!id) return newPid();
        let n = re.get(id);
        n || re.set(id, (n = newPid()));
        return n;
      }
      if (!id || (claim && claim.has(id))) id = newPid();
      claim && claim.add(id);
      return id;
    };
    const settle = (g) => {
      const id = own(g.id || (re ? g.want : null));
      if (g.from && S.asm[g.from] && !S.asm[id]) S.asm[id] = S.asm[g.from];
      return (g.id = id);
    };
    for (const r of S.roofs) r.id = own(r.id);
    for (const r of S.rings) r.id = own(r.id);
    for (const st of S.stairs) st.id = own(st.id);
    for (const p of S.pillars) ((p[2] = p[2] || "timber"), (p[3] = p[3] || "pillar"), (p[4] = own(p[4])));
    for (const p of S.paths) ((p[5] = p[5] || "cobble"), (p[6] = own(p[6])));
    for (const it of S.decor) ((it[3] = it[3] || 0), (it[4] = it[4] || 0), (it[5] = own(it[5])));
    for (const p of S.polyRoofs) ((p[2] = p[2] || "thatch"), (p[3] = own(p[3])));
    // grid walls, and the doors and windows in them
    const runs = gridRuns(S),
      oid = new Map();
    vote(runs, (e) => S.wid.get(e.k), taken);
    S.wid = new Map();
    for (const g of runs) {
      settle(g);
      for (const e of g.m) {
        S.wid.set(e.k, g.id);
        if (isDoor(e.type) || isWin(e.type)) oid.set(e.k, own(S.oid.get(e.k)));
      }
    }
    S.oid = oid;
    S.runs = runs;
    // free doors and windows: each belongs to the run that holds its whole rough opening, on plain wall only
    S.fopen = [];
    const keepFree = [],
      onAngled = [];
    for (const f of S.free) {
      const sp = OP.freeSpec(f);
      if (!sp) continue;
      if (f.d === "f") {
        onAngled.push([f, sp]);
        continue;
      }
      const a = f.pos - OP.ROUGH_GAP,
        b = f.pos + sp.w + OP.ROUGH_GAP,
        g = runs.find((r) => r.d === f.d && r.line === f.line && a >= r.t0 - 1e-6 && b <= r.t1 + 1e-6);
      if (!g || g.cls !== "wall" || g.m.some((e) => e.t + 1 > a && e.t < b && e.type !== "wall")) continue;
      f.id = own(f.id);
      Object.defineProperty(f, "out", { value: freeOut(S, f, sp.w), writable: true, enumerable: false, configurable: true });
      keepFree.push(f);
      S.fopen.push({ f, g, off: f.pos - g.t0, sp });
    }
    // where a free door leaves the wall open to walk through: the solid stretches left of each wall module
    S.doorGaps = new Map();
    for (const o of S.fopen) {
      if (o.sp.type.kind !== "door") continue;
      // a door with sidelights is open only across its leaf
      const lf = o.sp.leaf,
        a = o.f.pos + (lf && lf.a > 0 ? lf.a : -OP.ROUGH_GAP),
        b = o.f.pos + (lf && lf.b < o.sp.w - 1e-6 ? lf.b : o.sp.w + OP.ROUGH_GAP);
      for (const e of o.g.m) {
        if (e.t + 1 <= a || e.t >= b) continue;
        const c0 = Math.max(0, a - e.t),
          c1 = Math.min(1, b - e.t),
          next = [];
        for (const [x0, x1] of S.doorGaps.get(e.k) || [[0, 1]]) {
          x0 < c0 && next.push([x0, Math.min(x1, c0)]);
          x1 > c1 && next.push([Math.max(x0, c1), x1]);
        }
        S.doorGaps.set(e.k, next.filter((q) => q[1] - q[0] > 1e-6));
      }
    }
    // free-angle walls
    const fr = freeRuns(S);
    vote(fr, (n) => S.segs[n][6], taken);
    for (const sg of S.segs) ((sg[5] = sg[5] || "timber"), (sg[6] = sg[6] || null), (sg[7] = sg[7] || null));
    for (const g of fr) {
      settle(g);
      for (const n of g.m) {
        const sg = S.segs[n];
        sg[6] = g.id;
        sg[7] = isDoor(sg[4]) || isWin(sg[4]) ? own(sg[7]) : null;
      }
    }
    S.fruns = fr;
    // doors and windows in angled walls: each belongs to the straight wall that lies along it and holds its whole rough
    // opening. The record is re-based on that wall each time (its start and direction), so it survives the wall being redrawn.
    for (const [f, sp] of onAngled) {
      let hit = null;
      for (const g of fr) {
        const dot = f.ux * g.ux + f.uz * g.uz;
        if (Math.abs(Math.abs(dot) - 1) > 1e-3) continue;
        const ex = f.gx + f.ux * f.pos - g.x0,
          ez = f.gz + f.uz * f.pos - g.z0;
        if (Math.abs(ex * g.uz - ez * g.ux) > 0.02) continue;
        const pos = dot > 0 ? ex * g.ux + ez * g.uz : ex * g.ux + ez * g.uz - sp.w;
        if (pos - OP.ROUGH_GAP < -1e-6 || pos + sp.w + OP.ROUGH_GAP > g.len + 1e-6) continue;
        hit = { g, pos, rev: dot < 0 };
        break;
      }
      if (!hit || hit.g.cls !== "wall") continue;
      const { g, pos, rev } = hit,
        a = pos - OP.ROUGH_GAP,
        b = pos + sp.w + OP.ROUGH_GAP;
      if (g.mods.some((q) => q.s + q.len > a + 1e-6 && q.s < b - 1e-6 && q.type !== "wall")) continue;
      Object.assign(f, { gx: g.x0, gz: g.z0, ux: g.ux, uz: g.uz, pos: Math.round(pos * 1000) / 1000 });
      if (rev) f.flip = !f.flip;
      f.id = own(f.id);
      Object.defineProperty(f, "out", { value: freeOut(S, f, sp.w), writable: true, enumerable: false, configurable: true });
      keepFree.push(f);
      S.fopen.push({ f, g, off: f.pos, sp });
    }
    S.free = keepFree;
    // floors
    const regs = floorAreas(S);
    vote(regs, (c) => S.fid.get(c), taken);
    S.fid = new Map();
    for (const g of regs) {
      settle(g);
      for (const c of g.m) S.fid.set(c, g.id);
    }
    S.regs = regs;
    // closed shapes of angled walls: remembered by a point inside them, with their floor surface
    const marks = [],
      used = new Set();
    for (const p of S.polys) {
      let m = S.pids.find((q) => !used.has(q) && pip(p.pts, q[0], q[1]));
      if (m) used.add(m);
      const [x, z] = m || insidePoint(p);
      p.id = own(m && m[2]);
      p.fmat = (m && m[3]) || "planks";
      marks.push([x, z, p.id, p.fmat]);
      const pr = S.polyRoofs.find((q) => pip(p.pts, q[0], q[1]));
      p.roofId = pr ? pr[3] : null;
      p.rmat = pr ? pr[2] : p.rmat;
    }
    S.pids = marks;
    // layer choices follow their pieces: a copy carries them over, and those of pieces that are gone are dropped
    const root = (id) => String(id).split(".")[0];
    if (re) {
      const asm = {};
      for (const k in S.asm) {
        const r = root(k);
        if (re.has(r)) asm[re.get(r) + k.slice(r.length)] = S.asm[k];
      }
      S.asm = asm;
      S.fresh = false;
    }
    let any = false;
    for (const k in S.asm) {
      any = true;
      break;
    }
    if (any) {
      const live = new Set();
      for (const g of runs) live.add(g.id);
      for (const g of fr) live.add(g.id);
      for (const g of regs) live.add(g.id);
      for (const p of S.polys) live.add(p.id);
      for (const r of S.roofs) live.add(r.id);
      for (const r of S.rings) live.add(r.id);
      for (const p of S.polyRoofs) live.add(p[3]);
      for (const k in S.asm) live.has(root(k)) || delete S.asm[k];
    }
  }

  /* ---------- construction: real members, build stages, what is built and what is still only planned ---------- */
  // src/framing.js lists every member of a building (piers, joists, studs, sheets, rafters, batts). Here they are
  // tied to the structures: each has an id, a stage and a built state, is drawn (solid when built, a pale ghost
  // when it is next to be built), is reported in pieces(), and decides what layers a wall, floor or roof reports.
  const FR = window.__framing,
    FOUNDATIONS = FR.FOUNDATIONS,
    STAGES = FR.STAGES,
    CONCRETE = col(0xb5b2aa),
    MEMBER_EXTRA = ["area", "thickness", "volume", "size", "plies", "roof", "opening", "height", "fin", "face", "surface", "ends", "profile"];
  const Lz = (material, thickness, role) => Object.freeze({ material, thickness, role });
  const footPal = new Map();
  function woodFoot(wm) {
    let p = footPal.get(wm);
    if (!p) footPal.set(wm, (p = WALLS[wm].courses ? WALLS[wm] : { ...WALLS[wm], stone: shade(WALLS[wm].beam, 1.15) }));
    return p;
  }
  const dropOf = (S) => (S.level || S.po ? 0.05 : FOUNDATIONS[S.found].drop);
  const stickWall = (cls, mat) => cls === "wall" && (mat === "timber" || mat === "dark" || mat === "batten");
  // every member of a structure, in its own metres above its base; kept until the structure changes
  function membersOf(S) {
    if (S.mem && S.mem.ver === S.ver) return S.mem;
    const H = EAVE * S.hs,
      kS = (H - 0.3) / (EAVE - 0.3),
      up = (y) => (y <= 0.3 ? y : 0.3 + (y - 0.3) * kS),
      yo = (S.hs - 1) * EAVE,
      desc = { found: S.level === 0 ? S.found : S.found === "plinth" ? "plinth" : "upper", spec: { ins: S.ins, lining: S.lining, deco: S.deco }, floors: [], walls: [], roofs: [] },
      groundY = (x, z) => {
        const [wx, wz] = toWorld(S, x, z);
        return G.heightAt(wx, wz) - S.y0;
      },
      opening = (list, s0, mlen, type, id) => {
        const sp = OPEN[type];
        sp && list.push({ id, kind: sp.kind, offset: s0 + sp.t0 * mlen, width: (sp.t1 - sp.t0) * mlen, sill: up(sp.y0), height: up(sp.y1) - up(sp.y0) });
      },
      side = (ax, az, bx, bz) => {
        // which side is outdoors: the one with no floor against the wall
        const L = Math.hypot(bx - ax, bz - az) || 1,
          nx = -(bz - az) / L,
          nz = (bx - ax) / L,
          mx = (ax + bx) / 2,
          mz = (az + bz) / 2,
          l = onFloorAt(S, mx + nx * 0.4, mz + nz * 0.4),
          r = onFloorAt(S, mx - nx * 0.4, mz - nz * 0.4);
        return l && r ? 0 : l ? -1 : 1;
      };
    if (!S.po) {
      for (const g of S.regs) desc.floors.push({ id: g.id, outline: outlineOf(g.m)[0], y0: 0, ground: S.level === 0, groundY, mat: g.mat });
      for (const p of S.polys) desc.floors.push({ id: p.id, outline: p.pts, y0: 0, ground: S.level === 0, groundY, mat: p.fmat });
      for (const g of S.runs) {
        if (!stickWall(g.cls, g.mat)) continue;
        const x = g.d === 0,
          a = x ? [g.t0, g.line] : [g.line, g.t0],
          b = x ? [g.t1, g.line] : [g.line, g.t1],
          opens = [];
        for (const e of g.m) opening(opens, e.t - g.t0, 1, e.type, S.oid.get(e.k));
        for (const o of S.fopen) o.g === g && opens.push(OP.freeToFraming(o.f, o.off));
        desc.walls.push({ id: g.id, a, b, y0: 0, h: H, out: side(a[0], a[1], b[0], b[1]), mat: g.mat, openings: opens, foot: desc.found === "plinth" ? 0.3 : undefined });
      }
      for (const g of S.fruns) {
        if (!stickWall(g.cls, g.mat)) continue;
        const opens = [];
        for (const q of g.mods) opening(opens, q.s, q.len, q.type, S.segs[q.idx][7]);
        for (const o of S.fopen) o.g === g && opens.push(OP.freeToFraming(o.f, o.off));
        desc.walls.push({ id: g.id, a: [g.x0, g.z0], b: [g.x1, g.z1], y0: 0, h: H, out: side(g.x0, g.z0, g.x1, g.z1), mat: g.mat, openings: opens, foot: desc.found === "plinth" ? 0.3 : undefined });
      }
      for (const r of S.roofs) {
        const parts = roofParts(r),
          R = { id: r.id, mat: r.mat || "thatch", planes: [], ridges: [], infills: [], ties: [], gutters: [], groundY };
        let n = 0,
          gi = 0;
        const topAt = (x, z) => {
          let best = -1e9;
          for (const pl of R.planes) {
            const e0 = pl.pts[0],
              t = (x - e0[0]) * -pl.facing[0] + (z - e0[1]) * -pl.facing[1];
            if (pl.run && t > -0.01 && t < pl.run + 0.01) best = Math.max(best, pl.eaveY + ((pl.ridgeY - pl.eaveY) * t) / pl.run);
          }
          return best < -1e8 ? H : best;
        };
        for (const q of parts) {
          // overhang: how far the plane runs past the walls at the ends of its eave edge (barge rafters go there)
          if (q.part === "plane") R.planes.push({ id: r.id + "." + n++, pts: q.pts, eaveY: q.eaveY + yo, ridgeY: q.ridgeY + yo, run: q.run, facing: q.facing, overhang: q.rake, eave: q.eave, drip: q.drip, pitch12: q.pitch12 });
          else if (q.part === "ridge") R.ridges.push({ a: q.a, b: q.b, y: q.y0 + yo });
          else if (q.part === "hip") (R.hips || (R.hips = [])).push({ a: q.a, b: q.b, y0: q.y0 + yo, y1: q.y1 + yo });
          else if (q.part === "gutter") (R.gutters || (R.gutters = [])).push({ a: q.a, b: q.b, y: q.y + yo, down: q.down, downs: q.downs, wall: q.wall, out: q.out, plane: r.id + "." + parts.slice(0, q.plane).filter((x) => x.part === "plane").length });
        }
        for (const q of parts) if (q.part === "infill") R.infills.push({ id: r.id + ".g" + gi++, a: q.a, b: q.b, y0: H, y1: q.y1 + yo, area: q.area, top: topAt });
        if (RIDGED[r.shape || "gable"]) {
          const ax = r.axis === "x",
            a0 = ax ? r.i0 : r.j0,
            a1 = (ax ? r.i1 : r.j1) + 1,
            b0 = ax ? r.j0 : r.i0,
            b1 = (ax ? r.j1 : r.i1) + 1,
            nt = Math.max(1, Math.round((a1 - a0) / 1.2));
          for (let k = 0; k <= nt; k++) {
            const a = a0 + 0.02 + ((a1 - a0 - 0.04) * k) / nt;
            R.ties.push({ a: ax ? [a, b0] : [b0, a], b: ax ? [a, b1] : [b1, a], y: H });
          }
        }
        desc.roofs.push(R);
      }
    }
    const list = FR.generate(desc),
      byParent = new Map(),
      byId = new Map();
    for (const m of list) {
      byId.set(m.id, m);
      let L = byParent.get(m.parent);
      if (!L) byParent.set(m.parent, (L = []));
      L.push(m);
    }
    // blueprint shapes for pieces that are not boxes: roof planes (the real outline, hips and valleys included) and gables
    const polys = new Map(),
      planePoly = new Map();
    for (const R of desc.roofs)
      for (const pl of R.planes) {
        const e0 = pl.pts[0],
          e1 = pl.pts[1],
          EL = Math.hypot(e1[0] - e0[0], e1[1] - e0[1]) || 1,
          ev = [(e1[0] - e0[0]) / EL, (e1[1] - e0[1]) / EL],
          up = pl.run ? [-pl.facing[0], -pl.facing[1]] : [-ev[1], ev[0]],
          k = pl.run ? (pl.ridgeY - pl.eaveY) / pl.run : 0;
        planePoly.set(
          pl.id,
          pl.pts.map((q) => [q[0], pl.eaveY + k * ((q[0] - e0[0]) * up[0] + (q[1] - e0[1]) * up[1]), q[1]])
        );
      }
    for (const m of list) {
      const pp = planePoly.get(m.parent);
      if (pp && m.draw === 0 && (m.stage === "roof-deck" || m.stage === "roofing" || m.type === "ceiling")) {
        // lift along the plane's normal by how far this layer sits off it
        const nl = Math.hypot(m.n[0], m.n[1], m.n[2]) || 1,
          lift = ((m.a[0] - pp[0][0]) * m.n[0] + (m.a[1] - pp[0][1]) * m.n[1] + (m.a[2] - pp[0][2]) * m.n[2]) / nl;
        polys.set(m.id, pp.map((q) => [q[0] + (m.n[0] / nl) * lift, q[1] + (m.n[1] / nl) * lift, q[2] + (m.n[2] / nl) * lift]));
      }
    }
    for (const R of desc.roofs)
      for (const g of R.infills) {
        const L = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) || 1,
          n = Math.max(2, Math.ceil(L / 0.3)),
          top = [],
          ux = (g.b[0] - g.a[0]) / L,
          uz = (g.b[1] - g.a[1]) / L,
          o = (g.out || 1) * 0.0;
        for (let i = 0; i <= n; i++) {
          const q = (L * i) / n;
          top.push([g.a[0] + ux * q, Math.max(g.y0 + 0.02, g.top(g.a[0] + ux * q, g.a[1] + uz * q)), g.a[1] + uz * q]);
        }
        const poly = [[g.a[0], g.y0, g.a[1]], [g.b[0], g.y0, g.b[1]], ...top.reverse()];
        void o;
        for (const suffix of [".sh", ".wr"]) polys.set(g.id + suffix, poly);
      }
    // the doors and windows: a thin panel in each opening
    const opens = [];
    for (const w of desc.walls) {
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1,
        ux = (w.b[0] - w.a[0]) / L,
        uz = (w.b[1] - w.a[1]) / L;
      for (const q of w.openings || []) {
        const c = q.offset + q.width / 2;
        opens.push({ id: q.id, stage: "openings", kind: q.kind, parent: w.id, a: [w.a[0] + ux * c, q.sill, w.a[1] + uz * c], b: [w.a[0] + ux * c, q.sill + q.height, w.a[1] + uz * c], n: [-uz, 0, ux], section: { b: q.width, d: q.kind === "door" ? 0.05 : 0.04 }, col: q.kind === "door" ? "timber" : "wrap" });
      }
    }
    return (S.mem = { ver: S.ver, list, byParent, byId, polys, opens, walls: desc.walls, roofs: desc.roofs, planes: new Map(desc.roofs.map((R) => [R.id, R.planes.map((p) => p.id)])) });
  }
  // every id of a structure that can be planned or built on its own: members, doors and windows, and the pieces
  // that are not made of members (stone walls, round rooms, stairs, pillars)
  function plannable(S, stage) {
    const out = [],
      mem = membersOf(S);
    for (const m of mem.list) (!stage || m.stage === stage) && out.push(m.id);
    if (!stage || stage === "openings") {
      for (const id of S.oid.values()) out.push(id);
      for (const sg of S.segs) sg[7] && out.push(sg[7]);
      for (const f of S.free) f.id && out.push(f.id);
    }
    if (!stage || stage === "wall-frame") {
      for (const g of S.runs) mem.byParent.has(g.id) || out.push(g.id);
      for (const g of S.fruns) mem.byParent.has(g.id) || out.push(g.id);
      for (const r of S.rings) out.push(r.id);
      for (const st of S.stairs) out.push(st.id);
      for (const p of S.pillars) out.push(p[4]);
    }
    return out;
  }
  // every id the structure now has: new ones start as plans while construction is on, gone ones leave the plan.
  // Also run when the add-on asks which structures there are, so a structure drawn this frame is never missed.
  function syncKnown(S) {
    if (S.knownVer === S.ver && S.knownMode === B.cmode && S.known) return;
    const ids = plannable(S),
      all = new Set(ids);
    if (S.known && B.cmode) for (const id of ids) S.known.has(id) || S.plan.add(id);
    S.known = all;
    for (const id of [...S.plan]) all.has(id) || S.plan.delete(id);
    S.knownVer = S.ver;
    S.knownMode = B.cmode;
  }
  // What of a structure is finished (drawn as it always was), what is still only a plan (drawn as a ghost of the
  // finished thing) and what is part way (its members are drawn one by one).
  function memberState(S) {
    const mem = membersOf(S);
    syncKnown(S);
    S.sitePlanned = mem.list.some((m) => m.kind === "site" && S.plan.has(m.id));
    const st = { all: !S.plan.size, mem, finRun: null, finFloor: null, finRoof: null, cur: null, built: null, shell: null };
    S.ghostW = null;
    S.studW = null;
    S.studSegs = null;
    S.deckGhost = false;
    if (st.all) return st;
    const P = (id) => S.plan.has(id),
      kids = (id) => mem.byParent.get(id),
      // a wall is closed in once its siding and its lining are on: until then its frame, and the batts going in, are what you see
      fin = (id, tail) => (kids(id) ? (tail === ".cl" ? !kids(id).some((m) => (m.kind === "cladding" || m.kind === "lining") && P(m.id)) : !P(id + tail)) : !P(id)),
      bare = (id) => (kids(id) ? kids(id).every((m) => P(m.id)) : true),
      Db = { ...S, floors: new Set(), walls: new Map(), segs: [], polys: [], roofs: [], rings: [], stairs: [], pillars: [], free: [] },
      Ds = { ...Db, floors: new Set(), walls: new Map(), segs: [], polys: [], roofs: [], rings: [], stairs: [], pillars: [], decor: [], paths: [], polyRoofs: [], free: [] };
    st.finRun = new Set();
    st.finFloor = new Set();
    st.finRoof = new Set();
    {
      // only what stands can be walked into: a wall whose frame is not up yet, and a floor with no deck, are not there
      const stands = (id) => (kids(id) ? kids(id).every((m) => m.stage !== "wall-frame" || !P(m.id)) : !P(id)),
        gone = new Set();
      S.ghostW = new Set();
      for (const g of S.runs) if (!stands(g.id)) for (const e of g.m) S.ghostW.add(e.k);
      for (const g of S.fruns) if (!stands(g.id)) for (const n of g.m) gone.add(S.segs[n].slice(0, 4).join(","));
      // bare framing, studs with no sheathing on them yet, is no wall to a person: you step through between the studs, the
      // way framers do. Only the player passes; a wall is solid once its first sheet is on (and a raised wall never traps you)
      const bareFrame = (id) => kids(id) && kids(id).some((m) => m.kind === "sheathing") && kids(id).every((m) => m.kind !== "sheathing" || P(m.id));
      S.studW = new Set();
      S.studSegs = new Set();
      for (const g of S.runs) if (stands(g.id) && bareFrame(g.id)) for (const e of g.m) S.studW.add(e.k);
      for (const g of S.fruns) if (stands(g.id) && bareFrame(g.id)) for (const n of g.m) S.studSegs.add(S.segs[n].slice(0, 4).join(","));
      if (gone.size) S.colSegs = S.colSegs.filter((sg) => !gone.has(sg.slice(0, 4).join(",")));
      S.deckGhost = mem.list.some((m) => (m.stage === "site" || m.stage === "foundation" || m.stage === "floor-frame" || m.stage === "subfloor") && P(m.id));
    }
    for (const g of S.runs) {
      const f = fin(g.id, ".cl"),
        D = f ? Db : bare(g.id) ? Ds : null;
      f && st.finRun.add(g.id);
      if (D) for (const e of g.m) D.walls.set(e.k, e.type);
      if (D) for (const o of S.fopen) o.g === g && D.free.push({ ...o.f, out: o.f.out, built: D === Db && !P(o.f.id) });
    }
    for (const g of S.fruns) {
      const f = fin(g.id, ".cl"),
        D = f ? Db : bare(g.id) ? Ds : null;
      f && st.finRun.add(g.id);
      if (D) for (const n of g.m) D.segs.push(S.segs[n]);
      if (D) for (const o of S.fopen) o.g === g && D.free.push({ ...o.f, out: o.f.out, built: D === Db && !P(o.f.id) });
    }
    for (const g of S.regs) {
      const f = fin(g.id, ".fl"),
        D = f ? Db : bare(g.id) && (!kids(g.id + ".fd") || bare(g.id + ".fd")) ? Ds : null;
      f && st.finFloor.add(g.id);
      if (D) for (const c of g.m) D.floors.add(c);
    }
    for (const p of S.polys) {
      const f = fin(p.id, ".fl");
      f && st.finFloor.add(p.id);
      if (f) Db.polys.push(p);
      else if (bare(p.id) && (!kids(p.id + ".fd") || bare(p.id + ".fd"))) Ds.polys.push({ ...p, roofed: false });
    }
    for (const r of S.roofs) {
      const pl = mem.planes.get(r.id) || [],
        f = !mem.list.some((m) => m.stage === "roofing" && pl.includes(m.parent) && P(m.id));
      f && st.finRoof.add(r.id);
      if (f) Db.roofs.push(r);
      else if (pl.every(bare) && !mem.list.some((m) => m.roof === r.id && !P(m.id))) Ds.roofs.push(r);
    }
    S.rings.forEach((r) => {
      const D = P(r.id) ? Ds : Db;
      D.rings.push(r);
    });
    for (const q of S.stairs) (P(q.id) ? Ds : Db).stairs.push(q);
    for (const q of S.pillars) (P(q[4]) ? Ds : Db).pillars.push(q);
    let cur = 99;
    for (const m of mem.list) if (P(m.id)) cur = Math.min(cur, STAGES.indexOf(m.stage));
    for (const id of S.plan) mem.byId.has(id) || (cur = Math.min(cur, STAGES.indexOf((S.oid.size && [...S.oid.values()].includes(id)) || S.free.some((f) => f.id === id) ? "openings" : "wall-frame")));
    st.cur = STAGES[cur] || null;
    st.built = Db;
    st.shell = Ds.walls.size || Ds.floors.size || Ds.segs.length || Ds.polys.length || Ds.roofs.length || Ds.rings.length || Ds.stairs.length || Ds.pillars.length ? Ds : null;
    return st;
  }
  // members are drawn as instances of one box: built ones solid, the next ones to build as a calm pale ghost
  const boxGeo = new T.BoxGeometry(1, 1, 1),
    memMat = new T.MeshLambertMaterial({ color: 0xffffff }),
    // one blueprint material for every piece not yet built: pale blue fill, a brighter rim near each edge (from the uv, so no post pass), three strengths
    ghostMat = (fill, rim) =>
      new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uFill: { value: fill }, uRim: { value: rim }, uCol: { value: new T.Color(0x4cbcff) } },
        vertexShader: "varying vec2 vUv;\nvoid main(){\n vUv = uv;\n vec4 p = vec4(position, 1.0);\n#ifdef USE_INSTANCING\n p = instanceMatrix * p;\n#endif\n gl_Position = projectionMatrix * modelViewMatrix * p;\n}",
        fragmentShader: "uniform float uFill; uniform float uRim; uniform vec3 uCol; varying vec2 vUv;\nvoid main(){\n vec2 d = abs(vUv - 0.5) * 2.0;\n float e = smoothstep(0.82, 1.0, max(d.x, d.y));\n gl_FragColor = vec4(mix(uCol, vec3(1.0), 0.5 * e), uFill + uRim * e);\n}",
      }),
    GHOST = { cur: ghostMat(0.22, 0.7), later: ghostMat(0.1, 0.28), dim: ghostMat(0.05, 0.14) },
    GHOSTP = Object.fromEntries(Object.entries(GHOST).map(([k, m]) => [k, Object.assign(m.clone(), { side: T.DoubleSide })])),
    // the shell of a plan nobody has started: a blueprint, not a pale copy of the finished colours. Cyan-blue fill, a line every
    // 0.4 m across (the stud spacing) and 0.6 m up, drawn in the building's own metres, and a brighter rim where a face turns away
    shellMat = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      uniforms: { uOp: { value: 0.3 }, uCol: { value: new T.Color(0x3fb4ff) } },
      vertexShader: "varying vec3 vP; varying vec3 vN; varying vec3 vV;\nvoid main(){\n vP = position; vN = normal;\n vec4 w = modelMatrix * vec4(position, 1.0);\n vV = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz - position;\n gl_Position = projectionMatrix * viewMatrix * w;\n}",
      fragmentShader: "uniform float uOp; uniform vec3 uCol; varying vec3 vP; varying vec3 vN; varying vec3 vV;\nvoid main(){\n vec3 n = normalize(vN);\n vec2 uv = abs(n.y) > 0.7 ? vP.xz / 0.4 : vec2((abs(n.x) > abs(n.z) ? vP.z : vP.x) / 0.4, vP.y / 0.6);\n vec2 g = abs(fract(uv - 0.5) - 0.5) / max(fwidth(uv), vec2(1e-4));\n float line = 1.0 - min(min(g.x, g.y), 1.0);\n float rim = pow(1.0 - abs(dot(n, normalize(vV))), 3.0);\n gl_FragColor = vec4(mix(uCol, vec3(0.85, 0.97, 1.0), 0.6 * line + 0.4 * rim), uOp * (0.55 + 1.4 * line + 0.9 * rim));\n}",
    });
  // house wrap: a thin white sheet with a faint printed band, made once
  const wrapMat = (() => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const x = cv.getContext("2d");
    x.fillStyle = "#f4f6f5";
    x.fillRect(0, 0, 128, 128);
    x.fillStyle = "rgba(60,90,140,0.16)";
    for (let i = 0; i < 128; i += 16) x.fillRect(i + 2, 58, 10, 12);
    x.fillStyle = "rgba(0,0,0,0.10)";
    x.fillRect(0, 0, 128, 3);
    const tex = new T.CanvasTexture(cv);
    tex.colorSpace = T.SRGBColorSpace;
    return new T.MeshLambertMaterial({ map: tex, color: 0xffffff });
  })();
  const tapeMat = new T.MeshLambertMaterial({ color: 0x8e9692 });
  // lap siding: each board is a flat box one course tall; on its face the material paints what the lap does in life. Under
  // the butt edge of the course above, a shadow line falls on the top of this board (darkest right under it, a soft fall
  // below); the board's own bottom edge, standing proud, catches the light. Only the face and back (local z) get it.
  // ch: the height of one course (m): a piece taller than that is several courses (siding goes up three at a time, boards four),
  // counted from the instance's height. groove: tongue-and-groove boards inside (a fine V line) instead of lapped siding
  const makeLapMat = (planes, ch = 0.18, groove = false) => {
  const lapMat = new T.MeshLambertMaterial({ color: 0xffffff, clippingPlanes: planes || null, clipIntersection: !!planes, clipShadows: !!planes });
  lapMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vLapUv; varying float vLapF;").replace("#include <begin_vertex>", "#include <begin_vertex>\n vLapUv = uv; vLapF = step(0.5, abs(normal.z));\n #ifdef USE_INSTANCING\n vLapUv.y *= max(1.0, floor(length(instanceMatrix[1].xyz) / " + ch.toFixed(3) + " + 0.5));\n #endif");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vLapUv; varying float vLapF;").replace("#include <color_fragment>", "#include <color_fragment>\n { float y = fract(vLapUv.y); float row = floor(vLapUv.y); " + (groove ? "float shade = 1.0 - 0.32 * (1.0 - smoothstep(0.0, 0.035, y)) - 0.18 * smoothstep(0.975, 1.0, y) + 0.05 * (fract(sin(row * 12.9898) * 43758.5453) - 0.5); float lit = 1.0;" : "float shade = 1.0 - 0.42 * smoothstep(0.86, 0.985, y) - 0.12 * smoothstep(0.6, 0.86, y); float lit = 1.0 + 0.12 * (1.0 - smoothstep(0.0, 0.07, y));") + " diffuseColor.rgb *= mix(1.0, shade * lit, vLapF); }");
  };
  lapMat.customProgramCacheKey = () => (groove ? "grooveBoards" : "lapSiding") + ch;
  return lapMat;
  };
  const lapMat = makeLapMat(null), grvMat = makeLapMat(null, 0.14, true);
  // insulation batts: soft and fibrous, pillowed between the studs (darker where they press against the framing), with fine
  // streaks of fibre along their length; the piece's own size sets the scale of the fibres
  const makeBattMat = (planes) => {
    const m = new T.MeshLambertMaterial({ color: 0xffffff, clippingPlanes: planes || null, clipIntersection: !!planes, clipShadows: !!planes });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vBUv; varying vec2 vBSz; varying float vBF;").replace("#include <begin_vertex>", "#include <begin_vertex>\n vBUv = uv; vBF = step(0.5, abs(normal.z)); vBSz = vec2(1.0);\n #ifdef USE_INSTANCING\n vBSz = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));\n #endif");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vBUv; varying vec2 vBSz; varying float vBF;\nfloat bh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }").replace("#include <color_fragment>", "#include <color_fragment>\n { vec2 q = vBUv * vBSz; float fib = 0.55 * bh(floor(vec2(q.x / 0.05, q.y / 0.004))) + 0.45 * bh(floor(vec2(q.x / 0.012, q.y / 0.002)) + 7.0); float px = sin(3.14159 * clamp(vBUv.x, 0.0, 1.0)), py = sin(3.14159 * clamp(vBUv.y, 0.0, 1.0)); float pillow = 0.72 + 0.28 * pow(px, 0.25) * pow(py, 0.6); diffuseColor.rgb *= mix(0.92 + 0.12 * fib, (0.88 + 0.18 * fib) * pillow, vBF); }");
    };
    m.customProgramCacheKey = () => "battFibre";
    return m;
  };
  const battMat = makeBattMat(null);
  // a building's own copies of the member materials, cut by its dollhouse planes like its walls: the siding (drawn as
  // boards, the whole outside of a sided wall) opens with the wall when you are inside
  // where the cut opens a piece you look into the box from inside: its back faces are drawn as a flat dark section, so a
  // cut wall reads as solid (the dollhouse look) instead of hollow boxes
  const capped = (m) => {
    m.side = T.DoubleSide;
    const before = m.onBeforeCompile, key = m.customProgramCacheKey && m.customProgramCacheKey.call(m);
    m.onBeforeCompile = (sh, r) => { before && before.call(m, sh, r); sh.fragmentShader = sh.fragmentShader.replace("#include <dithering_fragment>", "#include <dithering_fragment>\n if (!gl_FrontFacing) gl_FragColor = vec4(0.19, 0.155, 0.125, 1.0);"); };
    m.customProgramCacheKey = () => (key || "") + "|capped";
    return m;
  };
  const memberMats = (planes) => ({ mem: capped(Object.assign(memMat.clone(), { clippingPlanes: planes, clipIntersection: true, clipShadows: true })), lap: capped(makeLapMat(planes)), grv: capped(makeLapMat(planes, 0.14, true)), bat: capped(makeBattMat(planes)), wrap: capped(Object.assign(wrapMat.clone(), { clippingPlanes: planes, clipIntersection: true, clipShadows: true })), shp: capped(Object.assign(memMat.clone(), { vertexColors: true, clippingPlanes: planes, clipIntersection: true, clipShadows: true })) });
  // trim with mitered ends (docs/design/carpentry.md) is drawn as its real shape, not a box: each end cut at 45 degrees
  // across the face, the long point on the side away from the opening (m.long, along m.n). One small mesh per building
  const shpMat = new T.MeshLambertMaterial({ vertexColors: true });
  const isShaped = (m) => !!(m.ends && m.long && m.ends.includes("m45"));
  function shapedGeo(list, colorOf) {
    const pos = [], colA = [];
    const V = (o, u, n, t, x, y, z) => [o[0] + u[0] * x + n[0] * y + t[0] * z, o[1] + u[1] * x + n[1] * y + t[1] * z, o[2] + u[2] * x + n[2] * y + t[2] * z];
    for (const m of list) {
      const ax = m.b[0] - m.a[0], ay = m.b[1] - m.a[1], az = m.b[2] - m.a[2], L = Math.hypot(ax, ay, az) || 1, u = [ax / L, ay / L, az / L], n = m.n;
      const t = [u[1] * n[2] - u[2] * n[1], u[2] * n[0] - u[0] * n[2], u[0] * n[1] - u[1] * n[0]], o = [(m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2, (m.a[2] + m.b[2]) / 2];
      const d = m.section.d / 2, b = m.section.b / 2, c = colorOf(m);
      // along the piece at end s (-1 at a, +1 at b) and across it at v: a miter takes the width off the short side
      const X = (s, v) => s * (L / 2 - (m.ends[s < 0 ? 0 : 1] === "m45" && v * m.long < 0 ? 2 * d : 0));
      const P = (s, v, w) => V(o, u, n, t, X(s, v), v, w);
      const quad = (p0, p1, p2, p3) => { for (const q of [p0, p1, p2, p0, p2, p3]) (pos.push(q[0], q[1], q[2]), colA.push(c[0], c[1], c[2])); };
      for (const w of [-b, b]) { const f = w > 0; const q = [P(-1, -d, w), P(1, -d, w), P(1, d, w), P(-1, d, w)]; f ? quad(...q) : quad(q[0], q[3], q[2], q[1]); }
      for (const v of [-d, d]) { const q = [P(-1, v, -b), P(-1, v, b), P(1, v, b), P(1, v, -b)]; v > 0 ? quad(...q) : quad(q[0], q[3], q[2], q[1]); }
      for (const s2 of [-1, 1]) { const q = [P(s2, -d, -b), P(s2, d, -b), P(s2, d, b), P(s2, -d, b)]; s2 > 0 ? quad(...q) : quad(q[0], q[3], q[2], q[1]); }
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new T.Float32BufferAttribute(colA, 3));
    g.computeVertexNormals();
    return g;
  }
  const isLap = (m) => /^siding/.test(m.col || "") && m.type === "boards";
  const MCOL = { timber: col(0xdcbc8c), osb: col(0xc9a468), wrap: col(0xe8ecea), felt: col(0x3a3d43), batt: col(0xf4b9a8), siding: col(0xb8beb1), sidingDark: col(0x5d4a3b), trim: col(0xefece4), gypsum: col(0xe3e3de), primer: col(0xf4f3ef), pine: col(0xd8b583), concrete: CONCRETE, gravel: col(0x8f8b82) };
  for (const [k, h] of Object.entries(FR.ROOF_COLORS || {})) MCOL[k] = col(h); // the roofing layers while they go on (src/framing.js)
  // a wall paint's colour, from its finish key ("sage_eggshell"; src/sim/content/decor.js)
  const FINCOL = new Map(),
    finCol = (fin) => {
      if (!FINCOL.has(fin)) {
        const c = decoC(),
          p = c && c.finishOf(fin);
        FINCOL.set(fin, p ? col(p.hex) : MCOL.primer);
      }
      return FINCOL.get(fin);
    };
  const _m4 = new T.Matrix4(),
    _c = new T.Color();
  // ---- dollhouse caps. Where the cut opens a framed wall, a flat cap at the cut height covers its whole thickness (lining to
  // siding), as a cutaway drawing fills its sections: no studs, batts or hollows show. Only walls that are finished get one
  // (one under construction is meant to be seen into); openings the cut passes through are left open
  // the cap shows the wall in section, as one solid thing: the room's colour (lining, or its paint) on the inside, a pale
  // timber core, the siding's colour on the outside
  const capMat = (S) => S.capMat || (S.capMat = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide, clippingPlanes: S.capPl, clipIntersection: false }));
  const CAP_CORE = col(0xd9c6a3);
  const CAP_SKIP = new Set(["casing", "base", "stool", "caulk", "paint", "prime", "joint", "batt", "wiring", "pipe", "box"]);
  function capWalls(S) {
    const on = S.cutH < 99 && S.mem && S.mem.walls && S.mem.walls.length;
    if (!on) { if (S.capMesh) S.capMesh.visible = false; return; }
    const h = S.cutH, opensAt = [];
    for (const w of S.mem.walls) for (const q of w.openings || []) if (w.y0 + q.sill < h && w.y0 + q.sill + q.height > h) opensAt.push(q.id);
    const key = S.mem.ver + "|" + S.plan.size + "|" + opensAt.join() + "|" + S.mem.walls.filter((w) => w.y0 + (w.h || 0) > h && w.y0 < h).length;
    if (S.capKey !== key) {
      S.capKey = key;
      if (S.capMesh) (S.group.remove(S.capMesh), S.capMesh.geometry.dispose(), (S.capMesh = null));
      const pos = [], cols = [];
      for (const w of S.mem.walls) {
        if (w.y0 + (w.h || 0) <= h || w.y0 >= h) continue;
        const ms = (S.mem.byParent.get(w.id) || []).filter((m) => m.draw !== 0 && !CAP_SKIP.has(m.kind) && !(m.kind === "cladding" && m.type === "trim") && m.section && m.stage !== "foundation" && m.stage !== "floor-frame" && m.stage !== "subfloor");
        if (!ms.length || ms.some((m) => S.plan.has(m.id))) continue;          // still being built: leave it open to see
        const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1, ux = (w.b[0] - w.a[0]) / L, uz = (w.b[1] - w.a[1]) / L, N = [-uz, 0, ux];
        let lo = 1e9, hi = -1e9;
        const strips = [];      // [from, to, colour] across the wall: the faces you see in the cut
        const all = S.mem.byParent.get(w.id) || [], paintOf = (fc) => { const p2 = all.find((q) => q.kind === "paint" && q.surface === "walls" && q.face === fc && !S.plan.has(q.id)); return p2 ? finCol(p2.fin) : null; };
        for (const m of ms) {
          const ax = m.b[0] - m.a[0], ay = m.b[1] - m.a[1], az = m.b[2] - m.a[2], ml = Math.hypot(ax, ay, az) || 1, u = [ax / ml, ay / ml, az / ml], n = m.n;
          const t = [u[1] * n[2] - u[2] * n[1], u[2] * n[0] - u[0] * n[2], u[0] * n[1] - u[1] * n[0]], dot = (v) => Math.abs(v[0] * N[0] + v[2] * N[2]);
          const c = ((m.a[0] + m.b[0]) / 2 - w.a[0]) * N[0] + ((m.a[2] + m.b[2]) / 2 - w.a[1]) * N[2], half = (dot(t) * m.section.b + dot(n) * m.section.d + dot(u) * ml) / 2;
          if (half > 0.4) continue;      // a piece lying across the wall is not the wall
          lo = Math.min(lo, c - half); hi = Math.max(hi, c + half);
          if (m.kind === "lining") strips.push([c - half, c + half, paintOf(m.face) || MCOL[m.col] || MCOL.gypsum]);
          else if (m.kind === "cladding") strips.push([c - half, c + half, MCOL[m.col || "siding"] || MCOL.siding]);
        }
        if (!(hi > lo)) continue;
        // along the wall, less the openings the cut passes through
        const gaps = (w.openings || []).filter((q) => opensAt.includes(q.id)).map((q) => [q.offset, q.offset + q.width]).sort((p, q) => p[0] - q[0]);
        let x = 0;
        // the core across the whole thickness, then each face's strip a hair above it
        const band = (xa, xb, o0, o1, y, c) => { const P = (s2, o) => [w.a[0] + ux * s2 + N[0] * o, y, w.a[1] + uz * s2 + N[2] * o]; for (const q of [P(xa, o0), P(xb, o0), P(xb, o1), P(xa, o0), P(xb, o1), P(xa, o1)]) (pos.push(...q), cols.push(c[0], c[1], c[2])); };
        const quad = (xa, xb) => { band(xa, xb, lo, hi, 0, CAP_CORE); for (const [o0, o1, c] of strips) band(xa, xb, o0, o1, 0.002, c); };
        for (const [ga, gb] of gaps) { if (ga - x > 0.01) quad(x, ga); x = Math.max(x, gb); }
        if (L - x > 0.01) quad(x, L);
      }
      if (pos.length) {
        const g = new T.BufferGeometry();
        g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
        g.setAttribute("color", new T.Float32BufferAttribute(cols, 3));
        g.computeVertexNormals();
        S.capMesh = new T.Mesh(g, capMat(S));
        S.capMesh.receiveShadow = true;
        S.group.add(S.capMesh);
      }
    }
    if (S.capMesh) ((S.capMesh.visible = true), (S.capMesh.position.y = h - 0.0005));   // at the cut: nothing of the cut pieces shows above it
  }
  function dropMembers(S) {
    for (const m of S.memMeshes) {
      S.group.remove(m);
      m.userData.own && m.geometry.dispose();
      m.dispose && m.dispose();
    }
    S.memMeshes = [];
  }
  const GHOST_LATER = new Set(["insulation"]),
    ZERO4 = new T.Matrix4().makeScale(0, 0, 0);
  function drawMembers(S, st) {
    dropMembers(S);
    const mem = st.mem,
      P = (id) => S.plan.has(id),
      gs = B.gstage || st.cur,
      gi = STAGES.indexOf(gs),
      sk = B.supportKinds || {},
      // while building (not in Plan mode) only the current stage shows: each stage appears when it starts
      hideLater = B.cmode && !B.on && !B.showLater && !st.all,
      open = new Map(); // stage -> kinds still planned in it, for "needs the piers first"
    for (const m of mem.list) if (P(m.id)) (open.get(m.stage) || open.set(m.stage, new Set()).get(m.stage)).add(m.kind);
    // roof courses go on from the eave up: only the lowest one still to lay is the bright blueprint, the rest are faint
    const lowRow = new Map();
    for (const m of mem.list) if (m.course && P(m.id)) { const k = m.parent + m.kind; lowRow.set(k, Math.min(lowRow.has(k) ? lowRow.get(k) : 1e9, m.row)); }
    const sets = [[], []], // solid, solid under the roof
      ghosts = {}, // "level|top|poly" -> members
      ghostAdd = (m, top) => {
        const idx = STAGES.indexOf(m.stage);
        if (S.ghostOff && S.ghostOff.has(m.id)) return; // just fitted by hand: its blueprint is gone even before it is handed back
        if (m.kind === "site" || idx < gi || (idx > gi && GHOST_LATER.has(m.kind))) return;
        if (idx > gi && hideLater) return;
        const need = sk[m.kind],
          waits = idx === gi && need && need.some((k) => k !== m.kind && open.get(m.stage) && open.get(m.stage).has(k)),
          level = idx === gi ? (waits ? "dim" : m.course && m.row > lowRow.get(m.parent + m.kind) ? "later" : "cur") : "later",
          key = level + "|" + top + "|" + (mem.polys.has(m.id) ? 1 : 0);
        (ghosts[key] || (ghosts[key] = [])).push(m);
      };
    for (const m of mem.list) {
      const roofId = m.roof || (/^(roof-frame|roof-deck|dry-in|roofing)$/.test(m.stage) || m.type === "roof-batt" || m.type === "ceiling" ? m.parent.split(".")[0] : null),
        top = roofId ? 1 : 0;
      if (P(m.id)) {
        ghostAdd(m, top);
        continue;
      }
      // paint on the walls (docs/design/interior-finishes.md): the colour once it is on; primer only where no colour covers it
      if (m.kind === "paint" || m.kind === "prime") {
        if (m.kind === "paint" || P(m.id.replace(".pr", ".pt"))) sets[0].push(m);
        continue;
      }
      if (m.draw === 0) continue;
      if (m.stage === "foundation" || m.stage === "floor-frame") sets[0].push(m);
      else if (roofId) ((st.all || st.finRoof.has(roofId)) && m.kind !== "cladding") || sets[1].push(m);     // the gable's siding stays drawn, like the walls'
      else if (m.stage === "subfloor" || m.type === "floor-batt") (st.all || st.finFloor.has(m.parent)) || sets[0].push(m);
      else if (m.kind === "cladding" || m.kind === "casing" || m.kind === "base" || (m.kind === "lining" && (m.type === "gypsum" || m.type === "boards"))) sets[0].push(m); // and the trim inside // siding outside and drywall or boards inside stay drawn, even once the wall is finished
      else (st.all || st.finRun.has(m.parent)) || sets[0].push(m);
    }
    for (const m of mem.opens) P(m.id) && ghostAdd(m, 0);
    // a thin line where the walls will stand, so the site stays readable
    if (hideLater) {
      const pos = [],
        y = 0.04,
        seg = (x0, z0, x1, z1) => pos.push(x0, y, z0, x1, y, z1);
      for (const g of S.runs) for (const e of g.m) e.d === 0 ? seg(e.i, e.j, e.i + 1, e.j) : seg(e.i, e.j, e.i, e.j + 1);
      for (const sg of S.segs) seg(sg[0], sg[1], sg[2], sg[3]);
      if (pos.length) {
        const geo = new T.BufferGeometry();
        geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
        const ln = new T.LineSegments(geo, new T.LineBasicMaterial({ color: 0x4cbcff, transparent: true, opacity: 0.6, depthWrite: false }));
        ln.userData.own = true;
        ln.renderOrder = 3;
        S.group.add(ln);
        S.memMeshes.push(ln);
      }
    }
    const place = (mesh, list, k, solid) =>
      list.forEach((m, n) => {
        const ax = m.b[0] - m.a[0],
          ay = m.b[1] - m.a[1],
          az = m.b[2] - m.a[2],
          L = Math.hypot(ax, ay, az) || 1,
          d = m.section.d,
          b = m.section.b / L,
          nx = m.n[0],
          ny = m.n[1],
          nz = m.n[2];
        // columns: along the member, across its depth, across its breadth
        _m4.set(ax, nx * d, (ay * nz - az * ny) * b, (m.a[0] + m.b[0]) / 2, ay, ny * d, (az * nx - ax * nz) * b, (m.a[1] + m.b[1]) / 2, az, nz * d, (ax * ny - ay * nx) * b, (m.a[2] + m.b[2]) / 2, 0, 0, 0, 1);
        mesh.setMatrixAt(n, _m4);
        if (solid) {
          const c = m.kind === "paint" ? finCol(m.fin) : m.kind === "prime" ? MCOL.primer : MCOL[m.col || "timber"],
            v = m.kind === "paint" || m.kind === "prime" ? 1 : /^siding/.test(m.col || "") ? 0.975 + 0.05 * hash(n, list.length, 7) : 0.9 + 0.2 * hash(n, list.length, 7);
          mesh.setColorAt(n, _c.setRGB(c[0] * v, c[1] * v, c[2] * v));
        }
      });
    const add = (mesh, roof, solid) => {
      if (solid) mesh.castShadow = mesh.receiveShadow = true;
      else mesh.renderOrder = 3;
      mesh.userData.roof = roof;
      mesh.visible = !roof || S.roofOp > 0.5;
      mesh.computeBoundingSphere && mesh.computeBoundingSphere();
      S.group.add(mesh);
      S.memMeshes.push(mesh);
    };
    // mitered trim out of the boxes, into its own shaped mesh
    const shaped = [];
    for (let k = 0; k < sets.length; k++) if (sets[k].some(isShaped)) ((shaped.push(...sets[k].filter(isShaped))), (sets[k] = sets[k].filter((m) => !isShaped(m))));
    if (shaped.length) {
      const mesh = new T.Mesh(shapedGeo(shaped, (m) => (m.kind === "paint" ? finCol(m.fin) : MCOL[m.col || "timber"])), (S.memMats && S.memMats.shp) || shpMat);
      mesh.userData.own = true;
      add(mesh, false, true);
    }
    sets.forEach((list, k) => {
      if (!list.length) return;
      for (const wr of [0, 1, 2, 3, 4]) {      // 0 everything, 1 house wrap, 2 lap siding, 3 board lining (tongue and groove), 4 insulation batts
        const part = list.filter((m) => (m.col === "wrap" && m.kind === "membrane" ? 1 : isLap(m) ? 2 : m.kind === "lining" && m.type === "boards" ? 3 : m.kind === "insulation" ? 4 : 0) === wr);
        if (!part.length) continue;
        const MM = S.memMats || { mem: memMat, lap: lapMat, wrap: wrapMat, grv: grvMat, bat: battMat };
        const mesh = new T.InstancedMesh(boxGeo, wr === 1 ? MM.wrap : wr === 2 ? MM.lap : wr === 3 ? MM.grv : wr === 4 ? MM.bat : MM.mem, part.length);
        place(mesh, part, k, true);
        mesh.instanceMatrix.needsUpdate = true;
        add(mesh, k === 1, true);
      }
    });
    // seam tape: a thin darker strip round every opening, on the wrap edges that meet it
    {
      const mats = [],
        W = 0.05;
      for (const list of sets)
        for (const m of list) {
          if (!m.tape) continue;
          const U = new T.Vector3(m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2]),
            Uh = U.clone().normalize(),
            N = new T.Vector3(m.n[0], m.n[1], m.n[2]),
            O = new T.Vector3(m.out[0], m.out[1], m.out[2]).normalize().multiplyScalar(m.section.b + 0.0012),
            mid = new T.Vector3((m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2, (m.a[2] + m.b[2]) / 2),
            d = m.section.d;
          for (const e of m.tape) {
            const side = e === "l" || e === "r",
              c = e === "l" ? mid.clone().addScaledVector(N, -(d / 2 - W / 2)) : e === "r" ? mid.clone().addScaledVector(N, d / 2 - W / 2) : e === "b" ? new T.Vector3(m.a[0], m.a[1], m.a[2]).addScaledVector(Uh, W / 2) : new T.Vector3(m.b[0], m.b[1], m.b[2]).addScaledVector(Uh, -W / 2);
            mats.push(new T.Matrix4().makeBasis(side ? U : N.clone().multiplyScalar(d), side ? N.clone().multiplyScalar(W) : Uh.clone().multiplyScalar(W), O).setPosition(c));
          }
        }
      if (mats.length) {
        const mesh = new T.InstancedMesh(boxGeo, tapeMat, mats.length);
        mats.forEach((mm, n) => mesh.setMatrixAt(n, mm));
        mesh.instanceMatrix.needsUpdate = true;
        add(mesh, false, true);
      }
    }
    for (const key in ghosts) {
      const [level, top, poly] = key.split("|"),
        list = ghosts[key];
      if (poly === "1") {
        // a fan of triangles from the middle of each outline: uv is 0.5 there and 1 at the edge, so the rim glows
        const pos = [],
          uv = [];
        for (const m of list) {
          const v = mem.polys.get(m.id),
            c = [0, 0, 0];
          for (const q of v) for (let i = 0; i < 3; i++) c[i] += q[i] / v.length;
          for (let i = 0; i < v.length; i++) {
            const q = v[i],
              r = v[(i + 1) % v.length];
            pos.push(c[0], c[1], c[2], q[0], q[1], q[2], r[0], r[1], r[2]);
            uv.push(0.5, 0.5, 1, 1, 1, 1);
          }
        }
        const g = new T.BufferGeometry();
        g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
        g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
        const mesh = new T.Mesh(g, GHOSTP[level]);
        mesh.userData.own = true;
        mesh.frustumCulled = false;
        add(mesh, top === "1", false);
      } else {
        const mesh = new T.InstancedMesh(boxGeo, GHOST[level], list.length);
        mesh.userData.gids = list.map((m) => m.id);
        place(mesh, list, 0, false);
        mesh.instanceMatrix.needsUpdate = true;
        add(mesh, top === "1", false);
      }
    }
    if (st.shell && !S.noShell) {
      const ga = buildGeo(st.shell, S.depth),
        g = ga.main;
      append(g.p, ga.glass.p), append(g.n, ga.glass.n), append(g.c, ga.glass.c);
      const
        mesh = new T.Mesh(g.build(), shellMat),
        rm = new T.Mesh(ga.roof.build(), shellMat);
      mesh.userData.own = rm.userData.own = true;
      rm.userData.roof = true;
      rm.visible = S.roofOp > 0.5;
      mesh.renderOrder = rm.renderOrder = 2;
      S.group.add(mesh, rm);
      S.memMeshes.push(mesh, rm);
    }
  }
  // what a framed wall is made of right now, from the outside in: only the layers that are built
  function builtWallLayers(S, id, mat, kids) {
    const ok = (f) => {
        const L = kids.filter(f);
        return L.length > 0 && L.every((m) => !S.plan.has(m.id));
      },
      out = [];
    if (!ok((m) => m.kind === "stud")) return Object.freeze(out);
    const outside = kids.some((m) => m.kind === "cladding");
    if (ok((m) => m.kind === "cladding")) out.push(Lz("softwood-boards", 0.019, "cladding"));
    if (ok((m) => m.kind === "membrane")) out.push(Lz("housewrap", 0.0002, "wrap"));
    if (ok((m) => m.kind === "sheathing")) out.push(Lz("osb", 0.011, "sheathing"));
    if (!outside && ok((m) => m.kind === "lining")) out.push(Lz("softwood-boards", 0.019, "lining"));
    out.push(ok((m) => m.kind === "insulation") ? Lz(S.ins, 0.089, "insulation") : Lz("air", 0.089, "cavity"));
    if (ok((m) => m.kind === "lining")) out.push(Lz(S.lining === "gypsum" ? "gypsum_board" : "softwood-boards", S.lining === "gypsum" ? 0.0127 : 0.019, "lining"));
    return Object.freeze(out);
  }
  function builtFloorLayers(S, id, def) {
    const kids = membersOf(S).byParent.get(id) || [],
      fd = membersOf(S).byParent.get(id + ".fd") || [],
      on = (f) => kids.concat(fd).some(f) && kids.concat(fd).filter(f).every((m) => !S.plan.has(m.id)),
      fin = on((m) => m.type === "flooring") ? [def[def.length - 1]] : [];
    if (kids.some((m) => m.kind === "joist")) {
      if (!on((m) => m.kind === "joist")) return Object.freeze([]);
      return Object.freeze([on((m) => m.kind === "insulation") ? Lz(S.ins, 0.14, "insulation") : Lz("air", 0.184, "joist-bay"), ...(on((m) => m.type === "subfloor") ? [Lz("osb", 0.018, "subfloor")] : []), ...fin]);
    }
    if (fd.some((m) => m.kind === "slab")) return Object.freeze(on((m) => m.kind === "slab") ? [Lz("gravel", 0.1, "base"), Lz("concrete", 0.1, "slab"), ...fin] : []);
    return S.plan.has(id) || !fin.length ? Object.freeze([]) : def;
  }
  function builtRoofLayers(S, pid, def) {
    const kids = membersOf(S).byParent.get(pid) || [],
      on = (f) => kids.some(f) && kids.filter(f).every((m) => !S.plan.has(m.id));
    if (!on((m) => m.kind === "rafter")) return Object.freeze([]);
    return Object.freeze([...(on((m) => m.kind === "roofing") ? [def[0]] : []), ...(on((m) => m.type === "roof-deck") ? [Lz("osb", 0.011, "deck")] : []), on((m) => m.kind === "insulation") ? Lz(S.ins, 0.14, "insulation") : Lz("air", 0.14, "rafter-bay")]);
  }
  // mark members (or everything a wall, floor, roof or foundation is made of) as built or as still planned
  function setBuilt(ids, on) {
    on = on !== false;
    let any = false;
    const pcs = listPieces(),
      want = new Set(Array.isArray(ids) ? ids : [ids]);
    for (const S of B.structs) {
      const mem = membersOf(S),
        own = new Set(plannable(S)),
        hit = [];
      for (const id of want) {
        if (own.has(id)) hit.push(id);
        else if (mem.byParent.has(id)) {
          for (const m of mem.byParent.get(id)) hit.push(m.id);
          for (const p of pcs) p.wall === id && p.struct === S.id && own.has(p.id) && hit.push(p.id);
        }
      }
      if (hit.length) markBuilt(S, hit, on), (any = true);
    }
    return any;
  }
  function markBuilt(S, ids, on) {
    const wasSite = S.sitePlanned;
    for (const id of ids) on ? S.plan.delete(id) : S.plan.add(id);
    if (S.ghostOff) for (const id of ids) S.ghostOff.delete(id);
    if (S.known) for (const id of ids) S.known.add(id);
    S.ver++;
    S.pc = null;
    S.sitePlanned = membersOf(S).list.some((m) => m.kind === "site" && S.plan.has(m.id));
    B.version++;
    // once the site is cleared and levelled, the ground really is
    if (wasSite && !S.sitePlanned) settle([S]);
    else B.dirty.add(S);
    touchUi();
  }
  function setStageBuilt(structId, stage, on) {
    let any = false;
    for (const S of B.structs) {
      if (structId !== undefined && structId !== null && S.id !== structId) continue;
      const ids = plannable(S, stage);
      if (ids.length) markBuilt(S, ids, on !== false), (any = true);
    }
    return any;
  }
  function setAllBuilt(on) {
    for (const S of B.structs) markBuilt(S, plannable(S), on !== false);
  }
  // what to buy, by stage, for one building (a structure id) or for everything
  function materialsList(structId) {
    const list = listPieces().filter((p) => p.stage && (structId === undefined || structId === null || p.struct === structId));
    return FR.materialsList(list);
  }
  // change what a building stands on; it rises or settles so that the ground under it stays where it is
  function setFound(S, v) {
    if (!FOUNDATIONS[v] || S.found === v) return;
    pushUndo();
    const grp = groupOf(S),
      base = grp.find((O) => O.level === 0) || S,
      delta = FOUNDATIONS[v].drop - dropOf(base);
    for (const O of grp) {
      O.found = v;
      O.y0 += delta;
      O.group.position.y = O.y0;
    }
    for (const O of grp) rebuild(O);
    touchUi();
  }
  /* ready-made plans: small buildings in real framing sizes, set down whole */
  const PLANS = {
    shed: { id: "shed", name: "Tool shed", size: "2.4 x 3.0 m", w: 2.4, l: 3.0, note: "A single-pitch roof, one door and one window, on six pier blocks.", roof: { shape: "shed", dir: 0, axis: "x", pitch12: 4, eave: 0.3, rake: 0.25, mat: "shingle", gutters: true }, door: [2, 0], windows: [[1, 1]], found: "pier-blocks", ins: null, lining: null },
    cabin: { id: "cabin", name: "Small cabin", size: "3.6 x 4.8 m", w: 3.6, winW: 0.9, l: 4.8, note: "A gable roof, a door and two windows, insulated and lined, on pier blocks.", roof: { shape: "gable", dir: 0, axis: "z", pitch12: 8, mat: "shingle", gutters: true }, door: [2, 1], windows: [[1, 2], [3, 2]], found: "pier-blocks", ins: "fibreglass_batt", lining: "boards" },
  };
  const planList = () => Object.values(PLANS).map((p) => ({ id: p.id, name: p.name, size: p.size, widthM: p.w, lengthM: p.l, note: p.note, foundation: p.found }));
  // door and windows are [side, module]: side 0 the back (z = 0), 1 the right, 2 the front, 3 the left
  // over: choices made for this copy of the plan, e.g. { lining: 'gypsum' } for drywall inside
  function placePlan(id, x, z, yawRad, over) {
    const pl = PLANS[id] && over ? { ...PLANS[id], ...over } : PLANS[id];
    if (!pl) return null;
    pushUndo();
    const S = newStruct({ ox: x, oz: z, yaw: yawRad || 0, y0: G.heightAt(x, z) + FOUNDATIONS[pl.found].drop - 0.05, level: 0, hs: 1, found: pl.found, ins: pl.ins, lining: pl.lining, deco: pl.deco || null, fresh: true }),
      hw = pl.w / 2,
      hl = pl.l / 2,
      cs = [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]];
    for (let k = 0; k < 4; k++) {
      const a = cs[k],
        b = cs[(k + 1) % 4],
        L = Math.hypot(b[0] - a[0], b[1] - a[1]),
        n = Math.max(1, Math.round(L));
      for (let m = 0; m < n; m++) S.segs.push([a[0] + ((b[0] - a[0]) * m) / n, a[1] + ((b[1] - a[1]) * m) / n, a[0] + ((b[0] - a[0]) * (m + 1)) / n, a[1] + ((b[1] - a[1]) * (m + 1)) / n, "wall", "timber", null, null]);
      // the plan's door and windows are catalog units, centred where its module would have been
      const ux = (b[0] - a[0]) / L,
        uz = (b[1] - a[1]) / L,
        put = (typeId, w, h, sill, m) => {
          const sizes = OP.openingSizes(typeId),
            sizeIdx = Math.max(0, sizes.findIndex((z) => Math.abs(z.w - w) < 1e-3 && Math.abs(z.h - h) < 1e-3));
          S.free.push({ id: null, typeId, sizeIdx, d: "f", gx: a[0], gz: a[1], ux, uz, pos: Math.round((((m + 0.5) * L) / n - w / 2) * 1000) / 1000, sill: sill, flip: false });
        };
      for (let m = 0; m < n; m++) {
        if (pl.door[0] === k && pl.door[1] === m) put(pl.doorType || "door_single", 0.81, 2.03, 0, m);
        else if (pl.windows.some((q) => q[0] === k && q[1] === m)) put(pl.windowType || "double_hung", pl.winW || 0.6, 1.2, 0.9, m);
      }
    }
    S.roofs.push({ i0: -hw, i1: hw - 1, j0: -hl, j1: hl - 1, ...pl.roof });
    rebuild(S);
    if (!S.sitePlanned) {
      const inner = [];
      for (let a = -hw; a <= hw + 1e-6; a += pl.w / 4) for (let b = -hl; b <= hl + 1e-6; b += pl.l / 4) inner.push(toWorld(S, a, b));
      cutTerrain(S, inner);
      rebuild(S);
    }
    touchUi();
    return { struct: S.id, pieces: structPieces(S).filter((p) => !p.parent).map((p) => p.id) };
  }

  /* ---------- equipment: fixtures from a catalog, and the wires and pipes between their ports ---------- */
  // A fixture is a panel, a tank, a stove: anything a system needs that is not part of the building's fabric. The
  // catalog comes from outside (setFixtureCatalog); until then a few demonstration pieces stand in. Fixtures and
  // connections are pieces like any other (ARCHITECTURE.md, "Fixtures and connections").
  const DEMO_FIXTURES = {
    demo_solar_panel: { id: "demo_solar_panel", name: "Solar panel 300 W", category: "solar", system: "electrical", ports: [{ id: "dc", type: "power" }], dims: { w: 1.0, d: 1.65, h: 0.04 }, priceUsd: 220, massKg: 19, ratedW: 300, settingsSchema: [{ key: "tiltDeg", label: "Tilt", type: "number", min: 0, max: 90, step: 5, unit: "°", default: 35 }, { key: "azimuthDeg", label: "Faces", type: "number", min: 0, max: 359, step: 15, unit: "°", default: 180 }] },
    demo_battery: { id: "demo_battery", name: "Battery 12 V 100 Ah", category: "battery", system: "electrical", ports: [{ id: "dc", type: "power" }], dims: { w: 0.33, d: 0.17, h: 0.22 }, priceUsd: 320, massKg: 12, capacityWh: 1200 },
    demo_light: { id: "demo_light", name: "Light", category: "light", system: "electrical", ports: [{ id: "in", type: "power" }], dims: { w: 0.2, d: 0.2, h: 0.25 }, priceUsd: 12, massKg: 0.4, ratedW: 9, settingsSchema: [{ key: "on", label: "Switched on", type: "boolean", default: true }] },
    demo_water_tank: { id: "demo_water_tank", name: "Water tank 1000 L", category: "tank", system: "water", ports: [{ id: "in", type: "water" }, { id: "out", type: "water" }], dims: { w: 1.1, d: 1.1, h: 1.3 }, priceUsd: 450, massKg: 25, capacityL: 1000 },
    demo_tap: { id: "demo_tap", name: "Tap", category: "tap", system: "water", ports: [{ id: "in", type: "water" }], dims: { w: 0.15, d: 0.2, h: 0.9 }, priceUsd: 18, massKg: 0.6, settingsSchema: [{ key: "open", label: "Open", type: "boolean", default: false }] },
    demo_wood_stove: { id: "demo_wood_stove", name: "Wood stove", category: "stove", system: "heating", ports: [{ id: "flue", type: "flue" }], dims: { w: 0.6, d: 0.5, h: 0.75 }, priceUsd: 900, massKg: 110, ratedW: 6000, settingsSchema: [{ key: "damper", label: "Air", type: "choice", options: ["low", "medium", "high"], default: "medium" }] },
  };
  const FX = { cat: DEMO_FIXTURES, list: [], links: [], kind: "demo_solar_panel", yaw: 0, sel: null, moving: null, from: null, v: 0, drawn: -1, group: new T.Group(), geo: new Map(), place: null, hov: null };
  G.scene.add(FX.group);
  const WIRE_GAUGES = [14, 12, 10, 8, 6, 4, 2, 0],
    PIPE_MM = [13, 19, 25, 32, 50],
    CONN = { power: { kind: "wire", name: "wire", material: "copper", key: "gauge", def: 12 }, water: { kind: "pipe", name: "pipe", material: "copper", key: "diameterMm", def: 19 }, flue: { kind: "pipe", name: "flue pipe", material: "steel", key: "diameterMm", def: 150 } };
  const fxMat = texel(new T.MeshLambertMaterial({ vertexColors: true })),
    fxGhost = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.55, depthWrite: false, fog: false })),
    fxHi = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ color: 0xffc95e, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false, fog: false })),
    wireMat = new T.MeshBasicMaterial({ vertexColors: true, fog: false });
  fxGhost.visible = fxHi.visible = false;
  fxGhost.frustumCulled = fxHi.frustumCulled = false;
  fxHi.renderOrder = 22;
  G.scene.add(fxGhost, fxHi);
  const fxDef = (id) => FX.cat[id] || DEMO_FIXTURES[id] || null;
  const fxWords = (d) => (d.shape || "") + " " + d.id + " " + (d.category || "") + " " + (d.name || "");
  const fxShape = (d) => {
    const w = fxWords(d).toLowerCase();
    return /gutter/.test(w) ? "gutter" : /solar|panel|pv/.test(w) ? "panel" : /batter/.test(w) ? "battery" : /tank|cistern|barrel/.test(w) ? "tank" : /pump/.test(w) ? "pump" : /stove|heater|boiler/.test(w) ? "stove" : /tap|faucet|shower|sink/.test(w) ? "tap" : /feeder|waterer|trough/.test(w) ? "feeder" : /light|lamp|bulb/.test(w) ? "light" : /nest|roost|coop/.test(w) ? "nest" : "box";
  };
  const fxSchema = (d) => (Array.isArray(d.settingsSchema) ? d.settingsSchema : d.settingsSchema ? Object.keys(d.settingsSchema).map((key) => ({ key, ...d.settingsSchema[key] })) : []);
  function fxDefaults(d) {
    const out = { ...(d.settings || {}) };
    for (const f of fxSchema(d)) if (out[f.key] === undefined && f.default !== undefined) out[f.key] = f.default;
    return out;
  }
  // a simple, tidy stand-in built from the catalog's dimensions: recognisable, not a model
  function fxGeo(d, tilt) {
    const shape = fxShape(d),
      key = d.id + "|" + shape + "|" + Math.round(tilt || 0);
    if (FX.geo.has(key)) return FX.geo.get(key);
    const g = new Geo(),
      { w, d: dp, h } = d.dims || { w: 0.5, d: 0.5, h: 0.5 },
      hw = w / 2,
      hd = dp / 2,
      IRON = col(0x34373c),
      STEEL = col(0xaab1b6),
      DARK = col(0x23272c);
    if (shape === "panel") {
      // dims are the panel lying flat: w across, d up the slope. Off a roof it stands on a rack at its tilt.
      const t = ((tilt || 0) * Math.PI) / 180,
        c = Math.cos(t),
        s = Math.sin(t),
        up = tilt ? 0.25 : 0,
        P = (x, v, o) => [x, up + (hd + v) * s + o * c, -v * c + o * s];
      // it faces its front (+z): the low edge is at the front, the high edge at the back
      g.obox(P(0, 0, 0.02), [hw, 0, 0], [0, hd * s, -hd * c], [0, 0.02 * c, 0.02 * s], STEEL);
      for (let a = 0; a < 3; a++) for (let b = 0; b < 5; b++) g.obox(P(-hw + (a + 0.5) * (w / 3), -hd + (b + 0.5) * (dp / 5), 0.042), [w / 6 - 0.012, 0, 0], [0, (dp / 10 - 0.012) * s, -(dp / 10 - 0.012) * c], [0, 0.004 * c, 0.004 * s], shade(col(0x1f3558), 0.9 + 0.2 * hash(a, b, 3)));
      if (tilt) for (const x of [-hw + 0.08, hw - 0.08]) (g.abox(x - 0.02, 0, -hd * c - 0.02, x + 0.02, up + 2 * hd * s, -hd * c + 0.02, STEEL), g.abox(x - 0.02, 0, hd * c - 0.02, x + 0.02, up, hd * c + 0.02, STEEL), g.abox(x - 0.02, 0, -hd * c, x + 0.02, 0.04, hd * c, STEEL));
    } else if (shape === "tank") {
      const c0 = col(0x4c6a58);
      g.cyl([0, 0, 0], [0, h * 0.9, 0], hw, hw, 14, shade(c0, 0.85), c0);
      g.cyl([0, h * 0.9, 0], [0, h, 0], hw, hw * 0.35, 14, c0, shade(c0, 1.15));
      for (const y of [0.25, 0.55]) g.cyl([0, h * y, 0], [0, h * y + 0.04, 0], hw + 0.012, hw + 0.012, 14, shade(c0, 0.7), shade(c0, 0.7), false);
      g.cyl([0, h, 0], [0, h + 0.05, 0], 0.12, 0.12, 8, DARK, DARK);
      g.cyl([0, 0.12, hd], [0, 0.12, hd + 0.08], 0.03, 0.03, 6, col(0xb08d3c), col(0xb08d3c));
    } else if (shape === "battery") {
      g.abox(-hw, 0, -hd, hw, h * 0.86, hd, DARK);
      g.abox(-hw - 0.006, h * 0.86, -hd - 0.006, hw + 0.006, h * 0.92, hd + 0.006, shade(DARK, 1.6));
      g.cyl([-hw * 0.6, h * 0.92, 0], [-hw * 0.6, h, 0], 0.016, 0.016, 6, col(0xb5352e), col(0xb5352e));
      g.cyl([hw * 0.6, h * 0.92, 0], [hw * 0.6, h, 0], 0.016, 0.016, 6, IRON, IRON);
    } else if (shape === "stove") {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.abox(sx * (hw - 0.06) - 0.03, 0, sz * (hd - 0.06) - 0.03, sx * (hw - 0.06) + 0.03, 0.14, sz * (hd - 0.06) + 0.03, IRON);
      g.abox(-hw, 0.14, -hd, hw, h, hd, IRON);
      g.abox(-hw - 0.02, h, -hd - 0.02, hw + 0.02, h + 0.03, hd + 0.02, shade(IRON, 1.4));
      g.abox(-hw * 0.6, 0.26, hd, hw * 0.6, h - 0.12, hd + 0.02, shade(IRON, 1.5));
      g.abox(-hw * 0.45, 0.34, hd + 0.02, hw * 0.45, h - 0.2, hd + 0.03, [1, 0.62, 0.2]);
      g.cyl([0, h, -hd * 0.4], [0, h + 1.5, -hd * 0.4], 0.075, 0.075, 8, shade(IRON, 0.9), IRON);
    } else if (shape === "tap") {
      const BR = col(0xb08d3c);
      g.cyl([0, 0, 0], [0, h, 0], 0.02, 0.02, 6, STEEL, STEEL);
      g.cyl([0, h, 0], [0, h, 0.13], 0.018, 0.018, 6, BR, BR);
      g.cyl([0, h, 0.13], [0, h - 0.06, 0.13], 0.016, 0.016, 6, BR, BR);
      g.abox(-0.05, h + 0.03, -0.012, 0.05, h + 0.05, 0.012, BR);
    } else if (shape === "pump") {
      g.abox(-hw, 0, -hd, hw, 0.05, hd, IRON);
      g.cyl([-hw * 0.8, h * 0.5, 0], [hw * 0.2, h * 0.5, 0], h * 0.38, h * 0.38, 10, col(0x2f5d86), col(0x3a6c98));
      g.cyl([hw * 0.2, h * 0.5, 0], [hw * 0.9, h * 0.5, 0], h * 0.3, h * 0.3, 10, STEEL, STEEL);
      g.cyl([hw * 0.55, h * 0.5, 0], [hw * 0.55, h, 0], 0.03, 0.03, 6, STEEL, STEEL);
    } else if (shape === "feeder") {
      g.cyl([0, 0.04, 0], [0, 0.1, 0], hw, hw, 12, STEEL, shade(STEEL, 0.8));
      g.cyl([0, 0.1, 0], [0, h * 0.8, 0], hw * 0.45, hw * 0.6, 12, shade(STEEL, 0.9), STEEL);
      g.cyl([0, h * 0.8, 0], [0, h, 0], hw * 0.66, 0.02, 12, col(0xb5352e), col(0xc8473c));
    } else if (shape === "light") {
      g.cyl([0, h, 0], [0, h * 0.45, 0], 0.012, 0.012, 5, DARK, DARK);
      g.cyl([0, h * 0.5, 0], [0, h * 0.2, 0], hw * 0.3, hw, 10, DARK, shade(DARK, 1.5), false);
      g.ball([0, h * 0.2, 0], hw * 0.35, hw * 0.35, hw * 0.35, [1, 0.9, 0.6], { lat: 3, lon: 6 });
    } else if (shape === "gutter") {
      g.abox(-hw, -0.1, 0.02, hw, -0.02, 0.14, STEEL);
      g.abox(-hw, -0.1, 0.02, hw, -0.09, 0.14, shade(STEEL, 0.7));
      g.cyl([hw - 0.1, -0.1, 0.08], [hw - 0.1, -0.5, 0.08], 0.035, 0.035, 6, STEEL, STEEL);
    } else if (shape === "nest") {
      const WD = col(0xb08a5a);
      g.abox(-hw, 0, -hd, hw, 0.03, hd, WD);
      g.abox(-hw, 0, -hd, hw, h, -hd + 0.02, shade(WD, 0.9));
      for (const sx of [-1, 1]) g.abox(sx * hw - 0.01, 0, -hd, sx * hw + 0.01, h, hd, shade(WD, 0.85));
      g.abox(-hw, h - 0.02, -hd, hw, h, hd, shade(WD, 1.1));
      g.abox(-hw, 0, hd - 0.02, hw, h * 0.3, hd, WD);
      g.ball([0, 0.07, 0], hw * 0.7, 0.05, hd * 0.7, col(0xcdb25e), { lat: 2, lon: 7 });
    } else {
      const c0 = col(0x8d9499);
      g.abox(-hw, 0, -hd, hw, h, hd, c0);
      g.abox(-hw * 0.7, h * 0.25, hd, hw * 0.7, h * 0.75, hd + 0.012, shade(c0, 1.25));
    }
    FX.geo.set(key, g);
    return g;
  }
  const fxTilt = (f) => (f.mount !== "roof" && fxShape(fxDef(f.fixture)) === "panel" ? (f.settings.tiltDeg === undefined ? 35 : +f.settings.tiltDeg) : 0);
  // where a port is, in world metres: along the front of the piece at a third of its height
  function portPos(f, pid) {
    const d = fxDef(f.fixture),
      n = d.ports.length,
      k = Math.max(0, d.ports.findIndex((p) => p.id === pid)),
      dm = d.dims || { w: 0.5, d: 0.5, h: 0.5 },
      lx = n > 1 ? -dm.w * 0.3 + (dm.w * 0.6 * k) / (n - 1) : 0,
      lz = fxShape(d) === "panel" ? 0 : dm.d / 2,
      c = Math.cos(f.yaw),
      s = Math.sin(f.yaw);
    return [f.x + lx * c + lz * s, f.y + (fxShape(d) === "panel" ? 0.12 : Math.min(dm.h * 0.35, 0.4)), f.z - lx * s + lz * c];
  }
  // the run of a wire or pipe: down to the foot of one piece, along the ground or floor, and up to the other
  function linkRoute(ln) {
    const A = FX.list.find((f) => f.id === ln.from.piece),
      Bq = FX.list.find((f) => f.id === ln.to.piece);
    if (!A || !Bq) return null;
    const a = portPos(A, ln.from.port),
      b = portPos(Bq, ln.to.port),
      ya = A.mount === "roof" || A.mount === "wall" ? Math.min(a[1], Bq.y) + 0.03 : A.y + 0.03,
      yb = Bq.mount === "roof" || Bq.mount === "wall" ? Math.min(b[1], ya) : Bq.y + 0.03,
      pts = [a, [a[0], ya, a[2]], [b[0], ya, a[2]], [b[0], yb, b[2]], b];
    let L = 0;
    for (let k = 1; k < pts.length; k++) L += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1], pts[k][2] - pts[k - 1][2]);
    return { pts, len: Math.round(L * 1000) / 1000 };
  }
  function fxDraw() {
    // the port dots belong to the Equip tool: leaving the tool or build mode redraws, so none linger
    const eq = B.on && B.tool === "equip";
    if (FX.drawn === FX.v && FX.eq === eq) return;
    FX.drawn = FX.v;
    FX.eq = eq;
    for (const m of [...FX.group.children]) (FX.group.remove(m), m.geometry.dispose());
    for (const f of FX.list) {
      const d = fxDef(f.fixture);
      if (!d || f.settings.viewOwned) continue;   // viewOwned: an add-on draws this one itself (a pump with a working handle)
      const m = new T.Mesh(fxGeo(d, fxTilt(f)).build(), fxMat);
      m.position.set(f.x, f.y, f.z);
      m.rotation.order = "YXZ";
      m.rotation.y = f.yaw;
      m.rotation.x = f.mount === "roof" ? ((f.tilt || 0) * Math.PI) / 180 : 0;
      m.castShadow = m.receiveShadow = true;
      FX.group.add(m);
    }
    const g = new Geo();
    for (const ln of FX.links) {
      const r = linkRoute(ln);
      if (!r) continue;
      const w = ln.kind === "wire" ? 0.012 : Math.max(0.015, (ln.diameterMm || 19) / 2000),
        c = ln.kind === "wire" ? [0.95, 0.7, 0.2] : (ln.diameterMm || 0) >= 100 ? [0.35, 0.36, 0.38] : [0.35, 0.65, 0.95],
        cc = ln.id === FX.sel ? [1, 1, 1] : c;
      for (let k = 1; k < r.pts.length; k++) {
        const p = r.pts[k - 1],
          q = r.pts[k];
        g.abox(Math.min(p[0], q[0]) - w, Math.min(p[1], q[1]) - w, Math.min(p[2], q[2]) - w, Math.max(p[0], q[0]) + w, Math.max(p[1], q[1]) + w, Math.max(p[2], q[2]) + w, cc);
      }
    }
    if (g.p.length) FX.group.add(new T.Mesh(g.build(), wireMat));
    // the dots the interface draws on ports and in the middle of each run
    const pv = [];
    if (eq) {
      // water ports get no dots: pipes are fitted by hand, part by part (docs/FIRST_WATER.md). Wires and flues stay here for now.
      for (const f of FX.list) for (const p of (fxDef(f.fixture) || { ports: [] }).ports) if (p.type !== "water") pv.push({ p: portPos(f, p.id), type: p.type, fid: f.id, pid: p.id, from: !!FX.from && FX.from.piece === f.id && FX.from.port === p.id });
      for (const ln of FX.links) {
        const r = linkRoute(ln);
        r && pv.push({ p: [(r.pts[1][0] + r.pts[3][0]) / 2, r.pts[1][1], (r.pts[1][2] + r.pts[3][2]) / 2], type: "link", lid: ln.id, text: fmtM(r.len), sel: ln.id === FX.sel });
      }
    }
    B.ov.ports = pv;
    B.ovVer++;
    const sf = FX.list.find((f) => f.id === FX.sel);
    fxHi.visible = B.on && !!sf;
    if (sf) {
      setGeo(fxHi, fxGeo(fxDef(sf.fixture), fxTilt(sf)));
      fxHi.position.set(sf.x, sf.y, sf.z);
      fxHi.rotation.order = "YXZ";
      fxHi.rotation.y = sf.yaw;
      fxHi.rotation.x = sf.mount === "roof" ? ((sf.tilt || 0) * Math.PI) / 180 : 0;
    }
  }
  // roofs stay on for the things that go on roofs, and lift away for everything else so you can reach indoors
  function fxRoofs() {
    if (FX.roofs !== undefined && FX.roofs !== null) return FX.roofs;
    const mv = FX.moving && FX.list.find((f) => f.id === FX.moving),
      d = fxDef(mv ? mv.fixture : FX.kind);
    return !!d && /panel|gutter/.test(fxShape(d));
  }
  const fxTouch = () => (FX.v++, B.version++, (B.key = ""), touchUi());
  const azOf = (fx, fz) => (((Math.atan2(fx, -fz) * 180) / Math.PI) % 360 + 360) % 360;
  // where the piece in hand would go: on a roof plane, against a wall, on a floor, or on the ground
  function fxPlacement(d) {
    const dm = d.dims || { w: 0.5, d: 0.5, h: 0.5 },
      o = ray.ray.origin,
      r = ray.ray.direction,
      pk = pickAt(ANY_PIECE),
      shape = fxShape(d),
      out = { x: pick.x, y: pick.y, z: pick.z, yaw: FX.yaw, mount: "ground", on: null, struct: null, tilt: 0, set: {}, text: "on the ground" };
    if (pk && pk.kind === "roof") {
      for (const p of listPieces()) {
        if (p.roof !== pk.id || p.kind !== "roof" || !p.footprint) continue;
        const tp = Math.tan((p.pitchDeg * Math.PI) / 180),
          nx = p.facing.x * tp,
          nz = p.facing.z * tp,
          den = r.x * nx + r.y + r.z * nz;
        if (Math.abs(den) < 1e-6) continue;
        const t = ((p.a.x - o.x) * nx + (p.eaveY - o.y) + (p.a.z - o.z) * nz) / den,
          x = o.x + r.x * t,
          z = o.z + r.z * t;
        if (t <= 0 || !pip(p.footprint.map((q) => [q.x, q.z]), x, z)) continue;
        Object.assign(out, { x, y: o.y + r.y * t + 0.09, z, mount: "roof", on: p.id, struct: p.struct, tilt: p.pitchDeg, yaw: p.pitchDeg > 3 ? Math.atan2(p.facing.x, p.facing.z) : FX.yaw });
        out.set = { roofPieceId: p.id, tiltDeg: Math.round(p.pitchDeg * 10) / 10, azimuthDeg: Math.round(p.pitchDeg > 3 ? azOf(p.facing.x, p.facing.z) : azOf(Math.sin(FX.yaw), Math.cos(FX.yaw))) };
        out.text = "on the roof · tilted " + Math.round(p.pitchDeg) + "°";
        if (shape === "gutter") {
          // a gutter hangs along the whole eave of the plane it is put on
          Object.assign(out, { x: (p.a.x + p.b.x) / 2, y: p.eaveY, z: (p.a.z + p.b.z) / 2, tilt: 0, yaw: Math.atan2(p.facing.x, p.facing.z) });
          out.set = { roofPieceId: p.id, lengthM: Math.round(p.length * 100) / 100 };
          out.text = "along the eave · " + fmtM(p.length);
        }
        return out;
      }
    }
    if (pk && (pk.kind === "wall" || (pk.kind === "ring" && pk.side !== undefined)) && pk.kind === "wall") {
      const p = pieceById(pk.id);
      if (p && p.length > 0.2) {
        const ex = p.b.x - p.a.x,
          ez = p.b.z - p.a.z,
          den = r.x * ez - r.z * ex;
        if (Math.abs(den) > 1e-9) {
          const t = ((p.a.x - o.x) * ez - (p.a.z - o.z) * ex) / den,
            L = Math.hypot(ex, ez);
          let nx = -ez / L,
            nz = ex / L;
          if (nx * r.x + nz * r.z > 0) ((nx = -nx), (nz = -nz));
          const off = 0.08 + (shape === "panel" || shape === "light" ? 0.02 : dm.d / 2);
          Object.assign(out, { x: o.x + r.x * t + nx * off, z: o.z + r.z * t + nz * off, y: clamp(o.y + r.y * t - dm.h / 2, p.y0 + 0.15, p.y1 - dm.h), mount: "wall", on: p.id, struct: p.struct, yaw: Math.atan2(nx, nz), text: "on the wall" });
          if (snapOn()) out.y = Math.round(out.y * 10) / 10;
          return out;
        }
      }
    }
    const h = B.hover;
    if (h && !h.F.isNew && !h.F.po && onFloorAt(h.F, h.lx, h.lz)) {
      const lx = snapOn() ? Math.round(h.lx * 4) / 4 : h.lx,
        lz = snapOn() ? Math.round(h.lz * 4) / 4 : h.lz,
        [x, z] = toWorld(h.F, lx, lz);
      Object.assign(out, { x, z, y: h.F.y0 + FLOOR_T, mount: "floor", on: h.F.fid.get(ck(Math.floor(lx), Math.floor(lz))) || (h.F.polys[polyAt(h.F, lx, lz)] || {}).id || null, struct: h.F.id, yaw: FX.yaw + h.F.yaw, text: "on the floor" });
    } else if (snapOn()) ((out.x = Math.round(out.x * 4) / 4), (out.z = Math.round(out.z * 4) / 4), (out.y = G.heightAt(out.x, out.z)));
    if (fxSchema(d).some((f) => f.key === "azimuthDeg") || shape === "panel") out.set = { azimuthDeg: Math.round(azOf(Math.sin(out.yaw), Math.cos(out.yaw))) };
    return out;
  }
  const fxAt = () => {
    const R = localRay({ ox: 0, oz: 0, yaw: 0, y0: 0 });
    let best = null,
      bt = 1e9;
    for (const f of FX.list) {
      const dm = (fxDef(f.fixture) || {}).dims || { w: 0.5, d: 0.5, h: 0.5 },
        w = Math.max(0.12, Math.max(dm.w, dm.d) / 2),
        t = hitBox(R, f.x - w, f.y - 0.1, f.z - w, f.x + w, f.y + Math.max(0.25, dm.h), f.z + w);
      if (t >= 0 && t < bt) ((bt = t), (best = f));
    }
    return best;
  };
  function fxPreview() {
    B.op = null;
    gridGroup.visible = ghostGroup.visible = false;
    if (B.ov.dims.length || B.ov.snap) ((B.ov.dims.length = 0), (B.ov.snap = null), B.ovVer++);
    const mv = FX.moving ? FX.list.find((f) => f.id === FX.moving) : null,
      d = fxDef(mv ? mv.fixture : FX.kind);
    FX.hov = mv ? null : fxAt();
    FX.place = null;
    fxGhost.visible = false;
    if (FX.from) return label("Drag to a port on another piece");
    if (FX.hov) return label("Click to select the " + fxDef(FX.hov.fixture).name.toLowerCase());
    if (!d || !pick.valid) return label("");
    const p = (FX.place = fxPlacement(d));
    setGeo(fxGhost, fxGeo(d, p.mount === "roof" ? 0 : fxShape(d) === "panel" ? (mv ? fxTilt(mv) : fxDefaults(d).tiltDeg === undefined ? 35 : fxDefaults(d).tiltDeg) : 0));
    fxGhost.position.set(p.x, p.y, p.z);
    fxGhost.rotation.order = "YXZ";
    fxGhost.rotation.y = p.yaw;
    fxGhost.rotation.x = p.mount === "roof" ? (p.tilt * Math.PI) / 180 : 0;
    fxGhost.visible = true;
    label(d.name + " · " + p.text);
  }
  function fxPut(f, p) {
    Object.assign(f, { x: p.x, y: p.y, z: p.z, yaw: p.yaw, mount: p.mount, on: p.on, struct: p.struct, tilt: p.tilt });
    if (p.mount !== "roof") (delete f.settings.roofPieceId, f.wasRoof && delete f.settings.lengthM);
    f.wasRoof = p.mount === "roof";
    Object.assign(f.settings, p.set);
  }
  function fxClick() {
    updateHover();
    setRay();
    fxPreview();
    if (FX.from) return void ((FX.from = null), fxTouch());
    if (FX.hov) return void ((FX.sel = FX.hov.id), FX.v++, (B.key = ""), touchUi());
    const p = FX.place;
    if (!p) return;
    pushUndo();
    if (FX.moving) (fxPut(FX.list.find((f) => f.id === FX.moving), p), (FX.sel = FX.moving), (FX.moving = null));
    else {
      const d = fxDef(FX.kind),
        f = { id: newPid(), fixture: d.id, settings: fxDefaults(d) };
      fxPut(f, p);
      FX.list.push(f);
      FX.sel = null;
      G.burst(p.x, p.y + 0.3, p.z, 5, 0xcdb48a, 1.4, 2, 0.08, 0.4);
    }
    fxTouch();
  }
  // join two ports. Returns { ok, id } or { ok: false, reason } in plain words.
  function fxConnect(a, ap, b, bp, opts) {
    const A = FX.list.find((f) => f.id === a),
      Bq = FX.list.find((f) => f.id === b),
      pa = A && fxDef(A.fixture).ports.find((p) => p.id === ap),
      pb = Bq && fxDef(Bq.fixture).ports.find((p) => p.id === bp),
      no = (reason) => ({ ok: false, reason });
    if (!pa || !pb) return no("There is no such port.");
    if (A === Bq) return no("A piece cannot be joined to itself.");
    if (pa.type !== pb.type) return no("A " + pa.type + " port cannot be joined to a " + pb.type + " port.");
    const c = CONN[pa.type];
    if (!c) return no("Nothing can be run from a " + pa.type + " port yet.");
    if (FX.links.some((l) => (l.from.piece === a && l.from.port === ap && l.to.piece === b && l.to.port === bp) || (l.from.piece === b && l.from.port === bp && l.to.piece === a && l.to.port === ap))) return no("These two ports are already joined.");
    pushUndo();
    const ln = { id: newPid(), kind: c.kind, from: { piece: a, port: ap }, to: { piece: b, port: bp }, material: (opts && opts.material) || c.material };
    ln[c.key] = (opts && opts[c.key]) || c.def;
    FX.links.push(ln);
    FX.sel = ln.id;
    fxTouch();
    return { ok: true, id: ln.id };
  }
  function fxPort(fid, pid, end) {
    if (!end && FX.from && (FX.from.piece !== fid || FX.from.port !== pid)) end = true;   // a second click finishes the run too
    if (!end) return void ((FX.from = { piece: fid, port: pid }), FX.v++, (B.key = ""), touchUi());
    const from = FX.from;
    FX.from = null;
    if (!from || (from.piece === fid && from.port === pid)) return void fxTouch();
    const r = fxConnect(from.piece, from.port, fid, pid);
    r.ok || ((B.fxNote = r.reason), (B.fxNoteT = performance.now()), fxTouch());
    return r;
  }
  function fxRemove(id) {
    const n = FX.list.length + FX.links.length;
    FX.list = FX.list.filter((f) => f.id !== id);
    FX.links = FX.links.filter((l) => l.id !== id && l.from.piece !== id && l.to.piece !== id);
    if (FX.sel === id) FX.sel = null;
    return n !== FX.list.length + FX.links.length;
  }
  function fxSetting(id, key, value) {
    const f = FX.list.find((q) => q.id === id);
    if (!f) return false;
    const sp = fxSchema(fxDef(f.fixture)).find((q) => q.key === key);
    if (sp && sp.type === "number") {
      value = +value;
      if (!isFinite(value)) return false;
      if (sp.min !== undefined) value = Math.max(sp.min, value);
      if (sp.max !== undefined) value = Math.min(sp.max, value);
    } else if (sp && sp.type === "boolean") value = !!value;
    else if (sp && sp.type === "choice" && !sp.options.some((o) => (o && o.value !== undefined ? o.value : o) === value)) return false;
    if ((key === "tiltDeg" || key === "azimuthDeg" || key === "roofPieceId") && f.mount === "roof") return false; // these come from the roof it is on
    f.settings[key] = value;
    if (key === "azimuthDeg") f.yaw = ((180 - value) * Math.PI) / 180;
    fxTouch();
    return true;
  }
  function fxAdd(list) {
    const ids = [];
    for (const q of list || []) {
      const d = fxDef(q.fixture);
      if (!d) {
        ids.push(null);
        continue;
      }
      const f = { id: q.id && !FX.list.some((o) => o.id === q.id) ? q.id : newPid(), fixture: d.id, x: q.x || 0, z: q.z || 0, y: q.y === undefined ? G.heightAt(q.x || 0, q.z || 0) : q.y, yaw: q.yawRad || 0, mount: q.mount || "ground", on: q.on || null, struct: q.struct || null, tilt: q.tilt || 0, settings: { ...fxDefaults(d), ...(q.settings || {}) } };
      FX.list.push(f);
      ids.push(f.id);
    }
    fxTouch();
    return ids;
  }
  function fxPieces(out) {
    for (const f of FX.list) {
      const d = fxDef(f.fixture);
      if (!d) continue;
      const dm = d.dims || { w: 0.5, d: 0.5, h: 0.5 },
        a = { x: f.x, z: f.z };
      out.push({ id: f.id, struct: f.struct, storey: 0, kind: "fixture", type: d.id, fixture: d.id, name: d.name, category: d.category, system: d.system, built: true, stage: "services", a, b: a, y0: f.y, y1: f.y + dm.h, yawRad: f.yaw, rotationRad: f.yaw, width: dm.w, depth: dm.d, height: dm.h, mount: f.mount, on: f.on, settings: { ...f.settings }, ports: d.ports.map((p) => ({ ...p })) });
    }
    for (const ln of FX.links) {
      const r = linkRoute(ln);
      if (!r) continue;
      const p = { id: ln.id, struct: null, storey: 0, kind: ln.kind, type: ln.kind, built: true, stage: "services", from: { ...ln.from }, to: { ...ln.to }, lengthM: r.len, material: ln.material, a: { x: r.pts[0][0], z: r.pts[0][2] }, b: { x: r.pts[4][0], z: r.pts[4][2] }, y0: Math.min(...r.pts.map((q) => q[1])), y1: Math.max(...r.pts.map((q) => q[1])) };
      if (ln.kind === "wire") p.gauge = ln.gauge;
      else p.diameterMm = ln.diameterMm;
      out.push(p);
    }
  }
  const fxSerial = () => ({ fixtures: FX.list.map((f) => ({ ...f, settings: { ...f.settings } })), links: FX.links.map((l) => ({ ...l, from: { ...l.from }, to: { ...l.to } })) });
  function fxRestore(d) {
    FX.list = ((d && d.fixtures) || []).map((f) => ({ ...f, settings: { ...f.settings } }));
    FX.links = ((d && d.links) || []).map((l) => ({ ...l, from: { ...l.from }, to: { ...l.to } }));
    FX.sel = FX.moving = FX.from = null;
    FX.v++;
  }
  // the inspector and the catalog, for the options strip
  function fxView(g) {
    const sel = FX.list.find((f) => f.id === FX.sel),
      ln = FX.links.find((l) => l.id === FX.sel);
    if (B.fxNote && performance.now() - B.fxNoteT < 6000) g.push(G_.info("Cannot join these", B.fxNote));
    if (sel) {
      const d = fxDef(sel.fixture),
        dm = d.dims || {},
        n = FX.links.filter((l) => l.from.piece === sel.id || l.to.piece === sel.id).length;
      g.push(G_.info(d.name, fmt(dm.w) + " × " + fmt(dm.d) + " × " + fmt(dm.h) + " m · " + (sel.mount === "roof" ? "on the roof" : sel.mount === "wall" ? "on a wall" : sel.mount === "floor" ? "on the floor" : "on the ground") + " · " + (n ? plural(n, "connection") : "not connected")));
      for (const f of fxSchema(d)) {
        const v = sel.settings[f.key],
          locked = sel.mount === "roof" && (f.key === "tiltDeg" || f.key === "azimuthDeg");
        if (f.type === "boolean") g.push(G_.toggle("fx:" + f.key, f.label || f.key, !!v, v ? "done" : "stop"));
        else if (f.type === "choice") g.push(G_.select("fx:" + f.key, f.label || f.key, f.options.map((o) => (o && o.value !== undefined ? { v: o.value, name: o.label || String(o.value) } : { v: o, name: String(o) })), v));
        else g.push({ ...G_.field("fx:" + f.key, f.label || f.key, fmt(+v || 0), f.unit || "", locked ? "Set by the roof it is on" : ""), locked });
      }
      g.push(G_.act("fx:turn", "Turn", "turn", "Shift wheel"));
      g.push(G_.act("fx:move", "Move", "copy"));
      g.push(G_.act("fx:del", "Remove", "bin", "Del", true));
      g.push(G_.act("fx:none", "Done", "done"));
    } else if (ln) {
      const r = linkRoute(ln),
        c = ln.kind === "wire" ? CONN.power : ln.diameterMm >= 100 ? CONN.flue : CONN.water,
        nm = (id) => (fxDef((FX.list.find((f) => f.id === id) || {}).fixture) || { name: "?" }).name;
      g.push(G_.info(c.name[0].toUpperCase() + c.name.slice(1) + " · " + fmtM(r ? r.len : 0), nm(ln.from.piece) + " to " + nm(ln.to.piece)));
      if (ln.kind === "wire") g.push(G_.chips("fx:gauge", "Gauge (AWG)", WIRE_GAUGES.map((v) => ({ v, name: v === 0 ? "1/0" : String(v) })), ln.gauge));
      else g.push(G_.chips("fx:dia", "Diameter", (ln.diameterMm >= 100 ? [100, 125, 150, 200] : PIPE_MM).map((v) => ({ v, name: v + " mm" })), ln.diameterMm));
      g.push(G_.act("fx:del", "Remove", "bin", "Del", true));
      g.push(G_.act("fx:none", "Done", "done"));
    } else {
      const all = Object.values(FX.cat),
        cur = fxDef(FX.kind) || all[0],
        sys = [...new Set(all.map((d) => d.system || "other"))];
      g.push(G_.chips("fx:sys", "", sys.map((v) => ({ v, name: v[0].toUpperCase() + v.slice(1) })), cur.system || "other"));
      g.push(G_.act("fx:turn", "Turn " + Math.round((((FX.yaw * 180) / Math.PI) % 360 + 360) % 360) + "°", "turn", "Shift wheel"));
      g.push(G_.toggle("fx:roofs", "Roofs", fxRoofs(), "roofs", "Show the roofs to put something on one; hide them to reach indoors"));
      g.push(G_.info(cur.name, (cur.priceUsd !== undefined ? "$" + cur.priceUsd + " · " : "") + (cur.dims ? fmt(cur.dims.w) + " × " + fmt(cur.dims.d) + " × " + fmt(cur.dims.h) + " m" : "")));
      g.push({ ...G_.chips("fx:kind", "", all.filter((d) => (d.system || "other") === (cur.system || "other")).map((d) => ({ v: d.id, name: d.name })), cur.id), row: 2 });
    }
  }
  function fxChoose(id, v) {
    const key = id.slice(3),
      sel = FX.list.find((f) => f.id === FX.sel),
      ln = FX.links.find((l) => l.id === FX.sel);
    if (key === "sys") FX.kind = (Object.values(FX.cat).find((d) => (d.system || "other") === v) || {}).id || FX.kind;
    else if (key === "kind") ((FX.kind = v), (FX.roofs = null));
    else if (key === "roofs") FX.roofs = !fxRoofs();
    else if (key === "none") FX.sel = null;
    else if (key === "sel") FX.sel = v;
    else if (key === "turn") {
      if (sel && sel.mount !== "roof") (pushUndo(), (sel.yaw += Math.PI / 4), sel.settings.azimuthDeg !== undefined && (sel.settings.azimuthDeg = Math.round(azOf(Math.sin(sel.yaw), Math.cos(sel.yaw)))), B.version++);
      else if (!sel) FX.yaw += Math.PI / 4;
    } else if (key === "move" && sel) FX.moving = sel.id;
    else if (key === "del" && FX.sel) (pushUndo(), fxRemove(FX.sel), B.version++);
    else if (key === "gauge" && ln) (pushUndo(), (ln.gauge = v), B.version++);
    else if (key === "dia" && ln) (pushUndo(), (ln.diameterMm = v), B.version++);
    else if (sel) {
      const sp = fxSchema(fxDef(sel.fixture)).find((f) => f.key === key);
      pushUndo();
      fxSetting(sel.id, key, sp && sp.type === "boolean" ? !sel.settings[key] : v);
    }
    FX.v++;
  }

  /* ---------- the piece interface ---------- */
  // Every built element as plain data (see ARCHITECTURE.md): what it is, what it is made of, and its size and
  // place in world metres. Structure, heat, salvage and the rest read buildings only through this list.
  const meanOf = (fn) => {
    let a = 0;
    for (let k = 0; k < 32; k++) a += fn((k + 0.5) / 32);
    return a / 32;
  };
  // An opening in a 1 m wall module: its clear width as a share of the module, its sill and head in a normal
  // storey (top: a curved head, across the width), and what fills it. These follow wallPieces() above.
  const OPEN = {
    door: { kind: "door", t0: 0.09, t1: 0.91, y0: 0.05, y1: 2.04, fill: "leaf" },
    door2: { kind: "door", t0: 0.05, t1: 0.95, y0: 0.05, y1: 2.24, fill: "leaf" },
    railgate: { kind: "door", t0: 0.09, t1: 0.91, y0: 0.04, y1: 1.14, fill: "leaf" },
    window: { kind: "window", t0: 0.1, t1: 0.9, y0: 1.11, y1: 1.89, fill: "glazing" },
    window2: { kind: "window", t0: 0.26, t1: 0.74, y0: 0.86, top: (u) => 1.71 + 0.42 * Math.sin(Math.PI * u), fill: "glazing" },
    window4: { kind: "window", t0: 0.33, t1: 0.67, y0: 1.11, y1: 1.89, fill: "shutters" },
    arch: { kind: "opening", t0: 0.11, t1: 0.89, y0: 0.05, top: (u) => 1.63 + 0.62 * Math.sin(Math.PI * u), fill: "none" },
    arch2: { kind: "opening", t0: 0.11, t1: 0.89, y0: 0.05, top: (u) => 1.41 + (1 - Math.abs(2 * u - 1)) ** 0.8, fill: "none" },
    arch3: { kind: "opening", t0: 0.11, t1: 0.89, y0: 0.05, top: (u) => 1.71 + 0.35 * Math.min(1, Math.min(u, 1 - u) / 0.2), fill: "none" },
  };
  for (const k in OPEN) {
    const o = OPEN[k];
    if (o.top) o.y1 = o.top(0.5);
    o.mean = o.top ? meanOf(o.top) : o.y1;
  }
  const polyArea = (pts) => {
    let a = 0;
    for (let n = 0; n < pts.length; n++) {
      const p = pts[n],
        q = pts[(n + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(a) / 2;
  };
  const polyLen = (pts) => {
    let a = 0;
    for (let n = 0; n < pts.length; n++) {
      const p = pts[n],
        q = pts[(n + 1) % pts.length];
      a += Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
    return a;
  };
  const tri3 = (a, b, c) => {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2],
      vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  };
  // The outline of a set of floor tiles as loops of corners, the outer edge first, then any holes.
  function outlineOf(cells) {
    const set = new Set(cells),
      next = new Map(),
      add = (x0, z0, x1, z1) => {
        const k = x0 + "," + z0;
        let L = next.get(k);
        if (!L) next.set(k, (L = []));
        L.push([x1, z1]);
      };
    // walk each open edge with the floor on the right
    for (const c of cells) {
      const [i, j] = parse(c);
      set.has(ck(i, j - 1)) || add(i, j, i + 1, j);
      set.has(ck(i + 1, j)) || add(i + 1, j, i + 1, j + 1);
      set.has(ck(i, j + 1)) || add(i + 1, j + 1, i, j + 1);
      set.has(ck(i - 1, j)) || add(i, j + 1, i, j);
    }
    const loops = [];
    for (const [k0, L0] of next)
      while (L0.length) {
        let [x, z] = parse(k0),
          dx = 0,
          dz = 0;
        const pts = [];
        for (let guard = 0; guard < 200000; guard++) {
          const L = next.get(x + "," + z);
          if (!L || !L.length) break;
          // where tiles meet corner to corner, keep to the tile we are walking round
          let pick = 0,
            best = -9;
          if (L.length > 1)
            L.forEach((e, n) => {
              const turn = dx * (e[1] - z) - dz * (e[0] - x);
              if (turn > best) ((best = turn), (pick = n));
            });
          const e = L.splice(pick, 1)[0];
          pts.push([x, z]);
          dx = e[0] - x;
          dz = e[1] - z;
          x = e[0];
          z = e[1];
          if (x + "," + z === k0) break;
        }
        // drop the points along straight edges
        const out = [];
        for (let n = 0; n < pts.length; n++) {
          const a = pts[(n + pts.length - 1) % pts.length],
            b = pts[n],
            c = pts[(n + 1) % pts.length];
          if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
        }
        out.length >= 4 && loops.push(out);
      }
    return loops.sort((p, q) => polyArea(q) - polyArea(p));
  }
  function decorBox(src) {
    if (src.bb) return src.bb;
    let x0 = 1e9,
      x1 = -1e9,
      y1 = 0,
      z0 = 1e9,
      z1 = -1e9;
    for (const q of [src.m.p, src.gl.p])
      for (let n = 0; n < q.length; n += 3) {
        x0 = Math.min(x0, q[n]);
        x1 = Math.max(x1, q[n]);
        y1 = Math.max(y1, q[n + 1]);
        z0 = Math.min(z0, q[n + 2]);
        z1 = Math.max(z1, q[n + 2]);
      }
    return (src.bb = { w: Math.max(0, x1 - x0), d: Math.max(0, z1 - z0), h: y1, r: Math.max(0.3, Math.hypot(x1 - x0, z1 - z0) / 2) });
  }
  function structPieces(S) {
    // pieces say what is built from the plan: bring the plan up to date first, so a piece made by this very edit starts unbuilt
    syncKnown(S);
    const out = [],
      pend = [],
      H = EAVE * S.hs,
      y0 = S.y0,
      kS = (H - 0.3) / (EAVE - 0.3),
      cy = Math.cos(S.yaw),
      sy = Math.sin(S.yaw);
    const W2 = (lx, lz) => {
      const [x, z] = toWorld(S, lx, lz);
      return { x, z };
    };
    const loop = (pts) => pts.map((q) => W2(q[0], q[1]));
    const head = (id, kind, type, material) => ({ id, struct: S.id, storey: S.level, kind, type, material, built: !S.plan.has(id) });
    const lay = (id, def) => S.asm[id] || def;
    const mem = membersOf(S),
      kids = (id) => mem.byParent.get(id) || null,
      done = (id) => !S.plan.has(id);
    // height above the structure's base of a point y up a wall module that starts lvl storeys up (low walls are not stretched)
    const up = (y, lvl, fixed) => (fixed ? y : (lvl || 0) * H + (y <= 0.3 ? y : 0.3 + (y - 0.3) * kS));
    // one opening: its module starts s0 metres along the wall from (ax, az) and is mlen long
    const opening = (list, wallId, mat, ax, az, ux, uz, s0, mlen, type, id, lvl, fixed) => {
      const sp = OPEN[type];
      if (!sp) return;
      const w = (sp.t1 - sp.t0) * mlen,
        off = s0 + sp.t0 * mlen,
        b0 = up(sp.y0, lvl, fixed),
        b1 = up(sp.y1, lvl, fixed),
        area = w * (up(sp.mean, lvl, fixed) - b0);
      list.push({ id: sp.kind === "opening" ? null : id, kind: sp.kind, type, offset: off, width: w, sill: b0, height: b1 - b0, y0: y0 + b0, y1: y0 + b1, area, fill: sp.fill });
      if (sp.kind === "opening") return;
      const L = sp.fill === "leaf" ? ASSEMBLIES.leaf : sp.fill === "none" ? [] : ASSEMBLIES.glazing;
      pend.push({ ...head(id, sp.kind, type, mat), a: W2(ax + ux * off, az + uz * off), b: W2(ax + ux * (off + w), az + uz * (off + w)), y0: y0 + b0, y1: y0 + b1, length: w, height: b1 - b0, thickness: sumT(L), area, layers: L, fill: sp.fill, wall: wallId });
    };
    // a free door or window: the unit in its rough opening, like the module ones
    const freeOpen = (opens, g, mat, ax, az, ux, uz) => {
      for (const o of S.fopen) {
        if (o.g !== g) continue;
        const sp = o.sp,
          k = sp.type.kind,
          off = o.off,
          L = k === "door" ? ASSEMBLIES.leaf : ASSEMBLIES.glazing,
          area = sp.w * sp.h;
        opens.push({ id: o.f.id, kind: k, type: o.f.typeId, offset: off, width: sp.w, sill: sp.sill, height: sp.h, y0: y0 + sp.sill, y1: y0 + sp.head, area, fill: k === "door" ? "leaf" : "glazing", free: true });
        pend.push({ ...head(o.f.id, k, o.f.typeId, mat), a: W2(ax + ux * off, az + uz * off), b: W2(ax + ux * (off + sp.w), az + uz * (off + sp.w)), y0: y0 + sp.sill, y1: y0 + sp.head, length: sp.w, height: sp.h, thickness: sumT(L), area, layers: L, fill: k === "door" ? "leaf" : "glazing", wall: g.id, unit: sp.itemId, unitName: sp.type.name + " " + Math.round(sp.w * 1000) + " x " + Math.round(sp.h * 1000) });
      }
    };
    const wall = (id, cls, mat, ax, az, bx, bz, len, opens, storeys, extra) => {
      const hgt = cls === "rail" ? 1.02 : H * (storeys || 1),
        L = S.asm[id] || (kids(id) ? builtWallLayers(S, id, mat, kids(id)) : wallLayers(cls, mat)),
        gross = len * hgt;
      let cut = 0;
      for (const o of opens) cut += o.area;
      out.push({ ...head(id, "wall", cls, mat), a: W2(ax, az), b: W2(bx, bz), y0: y0 + (extra && extra.base ? extra.base : 0), y1: y0 + (extra && extra.base ? extra.base : 0) + hgt, length: len, height: hgt, thickness: sumT(L), area: gross, netArea: gross - cut, layers: L, openings: opens, ...(extra && extra.more) });
      for (const p of pend) ((p.stage = "openings"), (p.parent = id), out.push(p));
      pend.length = 0;
    };
    const floorLay = (id, mat) => lay(id, ASSEMBLIES.floor[mat] || ASSEMBLIES.floor.planks);
    // the ground floor stands on a stone plinth, or on posts where it is raised well clear of the ground
    const footing = (id, a, b, area, outline, holes) => {
      if (S.level !== 0 || S.po) return;
      const posts = S.lift > 0 && S.depth > 1.6;
      const fd = S.found === "plinth" ? null : FOUNDATIONS[S.found];
      out.push({ ...head(id + ".fd", "foundation", fd ? S.found : posts ? "posts" : "plinth", fd ? (S.found === "skids" || S.found === "pier-blocks" ? "timber" : "concrete") : posts ? "timber" : "stone"), a, b, y0: y0 - (fd ? fd.drop : S.depth), y1: y0, height: fd ? fd.drop : S.depth, area, outline, holes, floor: id, stage: "foundation" });
    };

    for (const g of S.runs) {
      const opens = [],
        x = g.d === 0,
        ax = x ? g.t0 : g.line,
        az = x ? g.line : g.t0,
        len = g.t1 - g.t0;
      for (const e of g.m) OPEN[e.type] && opening(opens, g.id, g.mat, ax, az, x ? 1 : 0, x ? 0 : 1, e.t - g.t0, 1, e.type, S.oid.get(e.k), 0, g.cls === "rail");
      freeOpen(opens, g, g.mat, ax, az, x ? 1 : 0, x ? 0 : 1);
      wall(g.id, g.cls, g.mat, ax, az, x ? g.t1 : g.line, x ? g.line : g.t1, len, opens, 1);
    }
    for (const g of S.fruns) {
      const opens = [];
      for (const q of g.mods) OPEN[q.type] && opening(opens, g.id, g.mat, g.x0, g.z0, g.ux, g.uz, q.s, q.len, q.type, S.segs[q.idx][7], 0, g.cls === "rail");
      freeOpen(opens, g, g.mat, g.x0, g.z0, g.ux, g.uz);
      wall(g.id, g.cls, g.mat, g.x0, g.z0, g.x1, g.z1, g.len, opens, 1, { more: { free: true } });
    }
    for (const g of S.regs) {
      const loops = outlineOf(g.m),
        L = floorLay(g.id, g.mat),
        a = W2(g.i0, g.j0),
        b = W2(g.i1 + 1, g.j1 + 1),
        outline = loop(loops[0] || []),
        holes = loops.slice(1).map(loop);
      out.push({ ...head(g.id, "floor", "floor", g.mat), a, b, y0, y1: y0 + FLOOR_T, thickness: sumT(L), area: g.m.length, perimeter: loops.reduce((s, q) => s + polyLen(q), 0), outline, holes, layers: S.asm[g.id] || builtFloorLayers(S, g.id, L) });
      footing(g.id, a, b, g.m.length, outline, holes);
    }
    for (const p of S.polys) {
      let ax = 1e9,
        az = 1e9,
        bx = -1e9,
        bz = -1e9;
      for (const q of p.pts) ((ax = Math.min(ax, q[0])), (az = Math.min(az, q[1])), (bx = Math.max(bx, q[0])), (bz = Math.max(bz, q[1])));
      const L = floorLay(p.id, p.fmat),
        a = W2(ax, az),
        b = W2(bx, bz),
        outline = loop(p.pts);
      out.push({ ...head(p.id, "floor", "floor", p.fmat || "planks"), a, b, y0, y1: y0 + FLOOR_T, thickness: sumT(L), area: p.area, perimeter: polyLen(p.pts), outline, holes: [], layers: S.asm[p.id] || builtFloorLayers(S, p.id, L) });
      footing(p.id, a, b, p.area, outline, []);
      if (!p.roofed || !p.roofId) continue;
      // a pointed roof over the shape, its eave pushed out a little
      const rise = clamp(p.inr * 1.2, 1.2, 5),
        k = 1 + 0.55 / Math.max(p.rad, 1),
        eave = p.pts.map((q) => [p.cx + (q[0] - p.cx) * k, p.cz + (q[1] - p.cz) * k]),
        base = H - 0.12,
        RL = lay(p.roofId, ASSEMBLIES.roof[p.rmat] || ASSEMBLIES.roof.thatch),
        plan = polyArea(eave);
      let area = 0;
      for (let n = 0; n < eave.length; n++) {
        const e0 = eave[n],
          e1 = eave[(n + 1) % eave.length];
        area += tri3([e0[0], 0, e0[1]], [e1[0], 0, e1[1]], [p.cx, rise, p.cz]);
      }
      out.push({ ...head(p.roofId, "roof", "pyramid", p.rmat || "thatch"), a: W2(p.cx, p.cz), b: W2(p.cx, p.cz), y0: y0 + base, y1: y0 + base + rise, eaveY: y0 + base, ridgeY: y0 + base + rise, pitchDeg: (Math.acos(clamp(plan / area, 0, 1)) * 180) / Math.PI, area, planArea: plan, thickness: sumT(RL), footprint: loop(eave), facets: eave.length, layers: RL, over: p.id });
    }
    for (const r of S.roofs) {
      const mat = r.mat || "thatch",
        L = lay(r.id, ASSEMBLIES.roof[mat] || ASSEMBLIES.roof.thatch),
        base = y0 + H - EAVE;
      let n = 0,
        gi = 0;
      for (const q of roofParts(r)) {
        if (q.part === "plane") {
          const plan = polyArea(q.pts),
            pitch = q.run ? Math.atan2(q.ridgeY - q.eaveY, q.run) : 0,
            e0 = q.pts[0],
            e1 = q.pts[1];
          const pid = r.id + "." + n++;
          out.push({ ...head(pid, "roof", r.shape || "gable", mat), roof: r.id, a: W2(e0[0], e0[1]), b: W2(e1[0], e1[1]), y0: base + q.eaveY, y1: base + q.ridgeY, eaveY: base + q.eaveY, ridgeY: base + q.ridgeY, pitchDeg: (pitch * 180) / Math.PI, length: Math.hypot(e1[0] - e0[0], e1[1] - e0[1]), area: plan / Math.cos(pitch), planArea: plan, thickness: sumT(L), footprint: loop(q.pts), facing: { x: q.facing[0] * cy + q.facing[1] * sy, z: -q.facing[0] * sy + q.facing[1] * cy }, layers: S.asm[pid] || S.asm[r.id] || builtRoofLayers(S, pid, L) });
        } else if (q.part === "infill") {
          out.push({ ...head(r.id + ".g" + gi++, "wall", "gable", "timber"), roof: r.id, a: W2(q.a[0], q.a[1]), b: W2(q.b[0], q.b[1]), y0: base + q.y0, y1: base + q.y1, length: Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]), height: q.y1 - q.y0, thickness: sumT(FRAME_WALL), area: q.area, netArea: q.area, shape: q.shape, layers: FRAME_WALL, openings: [] });
        } // the ridge is one of the roof's members
      }
    }
    S.rings.forEach((r) => {
      const ri = ringInner(r),
        climb = r.floor !== false ? climbLevels(r) : 0,
        side = 2 * r.r * Math.sin(Math.PI / r.n),
        top = r.h * H,
        mat = r.mat || "timber",
        fm = r.fmat || "planks",
        c = W2(r.cx, r.cz),
        ngon = (rad) => 0.5 * r.n * rad * rad * Math.sin((2 * Math.PI) / r.n),
        ringLoop = (rad) => loop(Array.from({ length: r.n }, (_, k) => ringVert({ ...r, r: rad }, k))),
        parts = [];
      out.push({ ...head(r.id, "tower", "round", mat), a: c, b: c, radius: r.r, sides: r.n, storeys: r.h, y0, y1: y0 + top, height: top, area: ngon(r.r), parts });
      for (let k = 0; k < r.n; k++) {
        const ty = r.sides[k];
        if (!ty) continue;
        const a = ringVert(r, k),
          b = ringVert(r, k + 1),
          ux = (b[0] - a[0]) / side,
          uz = (b[1] - a[1]) / side,
          id = r.id + ".s" + k,
          opens = [];
        for (let l = 0; l < r.h; l++) {
          const t = l === 0 ? ty : k % 3 === 1 ? "window" : "wall";
          opening(opens, id, mat, a[0], a[1], ux, uz, 0, side, t, id + ".o" + l, l, false);
        }
        wall(id, "wall", mat, a[0], a[1], b[0], b[1], side, opens, r.h, { more: { tower: r.id } });
        parts.push(id);
      }
      // floors: the ground floor, and in a tower you can climb a landing on each storey round the stair
      const landing = (band) => {
        let nb = 0;
        for (let k = 0; k < r.n; k++) {
          const tk = (k + 0.5) / r.n,
            tf = tk - Math.floor(tk);
          if (band === true && tf < 0.4) nb++;
        }
        return (nb * (ngon(r.r) - ngon(ri - 1.05))) / r.n;
      };
      const deck = (id, lvl, rad, extra, m) => {
        const L = floorLay(id, m);
        out.push({ ...head(id, "floor", "floor", m), tower: r.id, a: c, b: c, radius: rad, y0: y0 + lvl * H, y1: y0 + lvl * H + FLOOR_T, thickness: sumT(L), area: ngon(rad) + extra, landingArea: extra, perimeter: 2 * r.n * rad * Math.sin(Math.PI / r.n), outline: ringLoop(rad), holes: [], layers: L });
        parts.push(id);
      };
      if (r.floor !== false) {
        deck(r.id + ".f0", 0, r.r, 0, fm);
        footing(r.id + ".f0", c, c, ngon(r.r), ringLoop(r.r), []);
      }
      if (climb) {
        for (let l = 1; l < r.h; l++) deck(r.id + ".f" + l, l, ri - 1.05, landing(l === climb ? true : null), fm);
        const rm = ri - 0.55;
        out.push({ ...head(r.id + ".st", "stair", "spiral", fm), tower: r.id, a: c, b: c, radius: rm, width: 0.92, turns: climb, steps: climb * 16, y0: y0 + FLOOR_T, y1: y0 + climb * H + FLOOR_T, height: climb * H, length: climb * 2 * Math.PI * rm });
        parts.push(r.id + ".st");
      }
      const shape = r.roof === true ? "cone" : r.roof;
      if (!shape) return;
      const dome = shape === "dome",
        re = r.r + (dome ? 0.3 : 0.55),
        rise = dome ? r.r * 0.95 : clamp(r.r * 1.35, 1.6, 6),
        base = top - (dome ? 0.1 : 0.12),
        rm = r.rmat || "thatch",
        id = r.id + ".r",
        L = lay(id, ASSEMBLIES.roof[rm] || ASSEMBLIES.roof.thatch),
        plan = ngon(re);
      let area = 0;
      if (dome) {
        const a1 = (2 * Math.PI) / r.n,
          P = (ang, f) => [Math.cos(ang) * re * Math.cos(f), rise * Math.sin(f), Math.sin(ang) * re * Math.cos(f)];
        for (let b = 0; b < 5; b++) {
          const f0 = ((b / 5) * Math.PI) / 2,
            f1 = (((b + 1) / 5) * Math.PI) / 2;
          area += tri3(P(0, f0), P(a1, f0), P(a1, f1)) + (b < 4 ? tri3(P(0, f0), P(a1, f1), P(0, f1)) : 0);
        }
        area *= r.n;
      } else area = (r.n * 2 * re * Math.sin(Math.PI / r.n) * Math.hypot(rise, re * Math.cos(Math.PI / r.n))) / 2;
      out.push({ ...head(id, "roof", shape, rm), tower: r.id, a: c, b: c, radius: re, y0: y0 + base, y1: y0 + base + rise, eaveY: y0 + base, ridgeY: y0 + base + rise, pitchDeg: (Math.acos(clamp(plan / area, 0, 1)) * 180) / Math.PI, area, planArea: plan, thickness: sumT(L), footprint: ringLoop(re), facets: r.n, layers: L });
      parts.push(id);
    });
    const sn = stairLen(S.hs);
    for (const st of S.stairs) {
      const [dx, dz] = DIRS[st.dir],
        sx = st.i + 0.5 - dx * 0.5,
        sz = st.j + 0.5 - dz * 0.5;
      out.push({ ...head(st.id, "stair", "straight", "timber"), a: W2(sx, sz), b: W2(sx + dx * sn, sz + dz * sn), y0: y0 + FLOOR_T, y1: y0 + FLOOR_T + H, length: sn, height: H, width: 0.92, steps: sn * 4 });
    }
    const pil = S.pillars;
    for (const p of pil) {
      const ch = p[3] === "chimney",
        topY = ch ? stretchY(5.78, S.hs) : H,
        c = W2(p[0], p[1]);
      out.push({ ...head(p[4], "post", ch ? "chimney" : "pillar", p[2] || "timber"), a: c, b: c, y0: y0 - (S.level ? 0 : S.depth), y1: y0 + topY, height: topY + (S.level ? 0 : S.depth), thickness: ch ? 0.64 : 0.34 });
    }
    // a beam joins any two pillars that stand within 4 m of each other
    for (let n = 0; n < pil.length; n++) {
      if (pil[n][3] === "chimney") continue;
      for (let m = n + 1; m < pil.length; m++) {
        const len = Math.hypot(pil[m][0] - pil[n][0], pil[m][1] - pil[n][1]);
        if (len > 4.01 || len < 0.4 || pil[m][3] === "chimney") continue;
        const lo = pidNum(pil[n][4]) < pidNum(pil[m][4]) ? pil[n] : pil[m],
          hi = lo === pil[n] ? pil[m] : pil[n];
        out.push({ ...head(lo[4] + "+" + hi[4], "beam", "beam", pil[n][2] || "timber"), a: W2(lo[0], lo[1]), b: W2(hi[0], hi[1]), y0: y0 + up(WALL_H + 0.02), y1: y0 + up(EAVE - 0.01), length: len, height: up(EAVE - 0.01) - up(WALL_H + 0.02), thickness: 0.2, posts: [lo[4], hi[4]] });
      }
    }
    for (const p of S.paths) {
      const len = Math.hypot(p[2] - p[0], p[3] - p[1]),
        a = W2(p[0], p[1]),
        b = W2(p[2], p[3]),
        h0 = G.heightAt(a.x, a.z),
        h1 = G.heightAt(b.x, b.z);
      out.push({ ...head(p[6], "path", "path", p[5] || "cobble"), a, b, y0: Math.min(h0, h1), y1: Math.max(h0, h1) + 0.05, length: len, width: p[4], thickness: 0.05, area: (len + 0.7 * p[4]) * p[4] });
    }
    for (const it of S.decor) {
      const def = DECOR[it[2]],
        y = decorY(S, it),
        bb = decorBox(decorGeo(it[2], it[4] || 0, H - y)),
        c = W2(it[0], it[1]);
      out.push({ ...head(it[5], "fixture", it[2], "mixed"), name: def.name, a: c, b: c, y0: y0 + y, y1: y0 + y + bb.h, height: bb.h, width: bb.w, depth: bb.d, rotationRad: S.yaw + ((it[3] || 0) * Math.PI) / 4, colour: DYES[it[4] || 0][0], light: !!def.light, cosy: def.cosy || 0 });
    }
    // every member of the construction, as a piece of its own; what it belongs to lists it and is built when they all are
    for (const p of out) {
      const k = kids(p.id);
      if (!k) continue;
      p.members = k.map((m) => m.id);
      p.built = k.every((m) => done(m.id));
    }
    for (const m of mem.list) {
      const ax = m.b[0] - m.a[0],
        ay = m.b[1] - m.a[1],
        az = m.b[2] - m.a[2],
        al = Math.hypot(ax, ay, az) || 1,
        wy = (az * m.n[0] - ax * m.n[2]) / al,
        e = (Math.abs(m.n[1]) * m.section.d + Math.abs(wy) * m.section.b) / 2,
        q = { ...head(m.id, m.kind, m.type, m.material), stage: m.stage, parent: m.parent, section: m.section, length: m.length, a: W2(m.a[0], m.a[2]), b: W2(m.b[0], m.b[2]), y0: y0 + Math.min(m.a[1], m.b[1]) - e, y1: y0 + Math.max(m.a[1], m.b[1]) + e };
      for (const f of MEMBER_EXTRA) if (m[f] !== undefined) q[f] = m[f];
      out.push(q);
    }
    return out;
  }
  const PC = { v: -1, list: [], byId: null };
  // The list is kept until something changes. Treat it as read only: copy what you want to keep or alter.
  function listPieces() {
    if (PC.v === B.version) return PC.list;
    const out = [];
    for (const S of B.structs) {
      if (!S.pc) S.pc = structPieces(S);
      for (const p of S.pc) out.push(p);
    }
    fxPieces(out);
    PC.v = B.version;
    PC.list = out;
    PC.byId = null;
    return out;
  }
  function pieceById(id) {
    listPieces();
    if (!PC.byId) {
      PC.byId = new Map();
      for (const p of PC.list) PC.byId.set(p.id, p);
    }
    return PC.byId.get(id) || null;
  }
  // Totals for a set of pieces (all of them if none is given): the start of a bill of materials.
  function quantities(list) {
    const q = { pieces: 0, wallLength: 0, wallArea: 0, floorArea: 0, roofArea: 0, roofPlanArea: 0, doors: 0, windows: 0, posts: 0, beams: 0, stairs: 0, fixtures: 0, pathLength: 0 };
    for (const p of list || listPieces()) {
      if (p.parent && p.kind !== "door" && p.kind !== "window") continue;   // members are counted through what they make up
      q.pieces++;
      if (p.kind === "wall" && p.type !== "gable") ((q.wallLength += p.length), (q.wallArea += p.netArea));
      else if (p.kind === "floor") q.floorArea += p.area;
      else if (p.kind === "roof") ((q.roofArea += p.area), (q.roofPlanArea += p.planArea));
      else if (p.kind === "door") q.doors++;
      else if (p.kind === "window") q.windows++;
      else if (p.kind === "post") q.posts++;
      else if (p.kind === "beam") q.beams++;
      else if (p.kind === "stair") q.stairs++;
      else if (p.kind === "fixture") q.fixtures++;
      else if (p.kind === "path") q.pathLength += p.length;
    }
    return q;
  }
  // A later iteration lets the player choose what a wall, floor or roof is built up of. The choice is kept with
  // the piece; null goes back to what its appearance implies.
  function setLayers(id, layers) {
    const key = String(id),
      rootId = key.split(".")[0];
    for (const S of B.structs) {
      if (!S.pc) S.pc = structPieces(S);
      if (!S.pc.some((p) => p.id === key || p.id === rootId || p.roof === key)) continue;
      if (layers) S.asm[key] = Object.freeze(layers.map((l) => Object.freeze({ ...l })));
      else delete S.asm[key];
      S.ver++;
      S.pc = null;
      B.version++;
      return true;
    }
    return false;
  }
  const changeFns = [];
  let changeV = 0;
  window.__build = {
    // the piece interface (ARCHITECTURE.md)
    pieces: listPieces,
    openUnits,
    operateUnit,
    piece: pieceById,
    quantities,
    get version() { return B.version; },
    // fn(version) is called when any piece has changed, at most once a frame; returns a function that stops it
    onChange(fn) {
      changeFns.push(fn);
      return () => {
        const n = changeFns.indexOf(fn);
        n >= 0 && changeFns.splice(n, 1);
      };
    },
    serialize,
    restore: restoreAll,
    ensureLoaded,
    setLayers,
    // construction (docs/CONSTRUCTION.md): stages, built state, the shopping list and ready-made plans
    STAGES,
    FOUNDATIONS,
    // building shows only the current stage unless the player asks for the later ones too (Feel: Show later stages)
    setShowLater(on) {
      on = !!on;
      if (B.showLater === on) return;
      B.showLater = on;
      for (const S of B.structs) B.dirty.add(S);
    },
    setConstructionMode(on) {
      B.cmode = !!on;
      touchUi();
    },
    get constructionMode() {
      return B.cmode;
    },
    setBuilt,
    // by-hand building: a piece that fits loses its own blueprint at once, without waiting for the batch to be handed back
    hideGhost(structId, ids) {
      const S = B.structs.find((q) => q.id === structId);
      if (!S) return;
      const set = S.ghostOff || (S.ghostOff = new Set()),
        gone = new Set();
      for (const id of ids) S.plan.has(id) && (set.add(id), gone.add(id));
      if (!gone.size) return;
      for (const mesh of S.memMeshes) {
        const g = mesh.userData.gids;
        if (!g) continue;
        let hit = false;
        for (let n = 0; n < g.length; n++) if (gone.has(g[n])) (mesh.setMatrixAt(n, ZERO4), (hit = true));
        if (hit) mesh.instanceMatrix.needsUpdate = true;
      }
    },
    setStageBuilt,
    setSupportKinds(t) {
      B.supportKinds = t;
      for (const S of B.structs) B.dirty.add(S);
    },
    setAllBuilt,
    showStage(stage) {
      B.gstage = stage || null;
      for (const S of B.structs) B.dirty.add(S);
    },
    materialsList,
    plans: planList,
    placePlan,
    // a building's finishes (docs/design/interior-finishes.md): null, or { walls, faces, trim, items }, each "<colour>_<sheen>"
    setDeco(structId, deco) {
      const S = B.structs.find((O) => O.id === structId);
      if (!S) return false;
      for (const O of groupOf(S)) ((O.deco = deco ? JSON.parse(JSON.stringify(deco)) : null), O.ver++);
      for (const O of groupOf(S)) rebuild(O);
      return true;
    },
    // roofs: the one geometry (see roofParts), what a roof measures, the roofer's warnings, and the coverings
    roofParts,
    roofStats,
    roofWarnings,
    roofMaterials: () => Object.keys(ROOFS).map((id) => ({ id, name: ROOFS[id].name, group: ROOFS[id].group, min: ROOFS[id].min || 0, max: ROOFS[id].max || null })),
    roofBuilding,
    // for the construction add-on: where each building stands and how much of it is still only planned
    structs: () => B.structs.map((S) => (syncKnown(S), { id: S.id, ver: S.ver, x: S.cx, z: S.cz, r: S.rad, y0: S.y0, yaw: S.yaw || 0, level: S.level, planned: S.plan.size, sitePlanned: !!S.sitePlanned, found: S.found })),
    // every member of one building in its own metres, with the matrix that puts them in the world
    membersOf(structId) {
      const S = B.structs.find((O) => O.id === structId);
      if (!S) return null;
      S.group.updateMatrixWorld(true);
      return { matrix: S.group.matrixWorld, y0: S.y0, list: membersOf(S).list, planned: S.plan, roofs: membersOf(S).roofs };
    },
    memberLook: () => ({ geo: boxGeo, mat: memMat, colors: MCOL, alt: { mat: lapMat, test: isLap },
      // the materials one building's pieces are drawn with (cut open with its walls when you are inside it), or null
      matsFor: (structId) => { const S = B.structs.find((O) => O.id === structId); return S && S.memMats ? { mat: S.memMats.mem, alt: S.memMats.lap } : null; } }),
    // called when the player climbs out of a room that has no door (see climbOut)
    setOnClimbOut(fn) {
      B.onClimbOut = fn;
    },
    // the pale shell of everything still unbuilt: shown for a plan nobody has started, hidden once work is under way
    setShell(structId, on) {
      const S = B.structs.find((O) => O.id === structId);
      if (!S || !!S.noShell === !on) return;
      S.noShell = !on;
      B.dirty.add(S);
    },
    removeStruct(structId) {
      const S = B.structs.find((O) => O.id === structId);
      if (!S) return false;
      pushUndo();
      disposeStruct(S);
      B.version++;
      touchUi();
      return true;
    },
    setFoundation(structId, type) {
      const S = B.structs.find((O) => O.id === structId);
      S && setFound(S, type);
    },
    ASSEMBLIES,
    get LAYER_MATERIALS() {
      const names = new Set();
      const walk = (v) => (Array.isArray(v) ? v.forEach((l) => names.add(l.material)) : Object.values(v).forEach(walk));
      walk(ASSEMBLIES);
      for (const m of Object.values(MASONRY)) names.add(m);
      return [...names].sort();
    },
    _t: { copyPick: () => copyPick(), stamp: () => stamp(), topWalk, rebuild, pickAt: () => pickAt(ANY_PIECE), refOf, stretchOp, snapPoint },
    key: onKey,
    // for the interface (src/buildui.js) and the touch controls
    view,
    choose,
    typed: typedSet,
    typedCommit: () => (freeTool() && B.fsel && !B.drag ? typedSize() : B.drag && commit()),
    typedClear,
    setType(fn) {
      B.typeHook = fn;
    },
    measClear,
    selection: () => B.sel.slice(),
    select: selSet,
    TOOL_LETTER,
    collide(e, r, isPlayer) {
      let near = null;
      for (const S of B.structs) {
        if (Math.hypot(e.x - S.cx, e.z - S.cz) > S.rad + r + 1.5) continue;
        const ey = e.y === undefined ? S.y0 : e.y;
        S.rings.length && ringHold(e, r, S);
        if (S.level ? ey < S.y0 + FLOOR_T - 0.65 || ey > S.y0 + EAVE * S.hs : ey > S.y0 + EAVE * S.hs - 0.3 || ey < S.y0 - 1.2) continue;
        const x0 = e.x,
          z0 = e.z;
        collideOnce(e, r, isPlayer, S);
        collideOnce(e, r, isPlayer, S);
        isPlayer && climbOut(e, S, e.x - x0, e.z - z0);
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
        if (!S.deckGhost && ((S.floors.has(ck(ci, cj)) && !wellOver(S, ci, cj)) || ringAt(S, lx, lz, 0.1) >= 0 || polyAt(S, lx, lz) >= 0)) {
          const top = S.y0 + FLOOR_T;
          if (y >= top - 0.65) g = Math.max(g, top);
        }
        if (S.rings.length) {
          const tw = topWalk(S, lx, lz, y);
          if (tw !== null) g = Math.max(g, tw);
        }
        const sh = stairH(S, lx, lz);
        if (sh !== null && y >= S.y0 + sh - 0.65) g = Math.max(g, S.y0 + sh);
      }
      return g;
    },
    update(dt) {
      ensureLoaded();
      leafBusy.size && leafTick(dt);
      if (B.on && (B.ohKey || (freeTool() && B.fsel))) ohTick();
      if (B.ores && B.ores.dirty && performance.now() - B.ores.t > 45) {
        const q = fselOpen();
        (B.ores.dirty = false), (B.ores.t = performance.now());
        q && rebuild(q.S);
      }
      flushCover(dt);
      if (B.dirty.size) {
        for (const S of B.dirty) B.structs.includes(S) && rebuild(S);
        B.dirty.clear();
      }
      if (changeV !== B.version) {
        changeV = B.version;
        for (const fn of changeFns.slice()) {
          try {
            fn(changeV);
          } catch (err) {
            console.error(err);
          }
        }
      }
      const on = P.tool === "build" && !(P.dead > 0);
      if (on !== B.on) on ? enter() : exit();
      if (B.version !== B.savedV && !B.drag) {
        B.saveT += dt;
        if (B.saveT > 1.2) {
          saveBuilds();
          B.savedV = B.version;
          B.saveT = 0;
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
      fadeRB.value = homeY !== null ? 1e-4 : G.fadeR ? G.fadeR.value : 1;
      const firstPerson = !!(G.camView && G.camView() === "first");
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
          const cutT = firstPerson ? 0 : onFloor ? 1.15 : inTower ? P.y - S.y0 + 1.05 : 0; // first person: the rooms stay whole
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
          S.capPl[0].copy(S.near).negate(); S.capPl[1].copy(S.sideA).negate(); S.capPl[2].copy(S.sideB).negate();
          capWalls(S);
          for (const dr of S.doors) {
            const [wx, wz] = toWorld(S, dr.mx, dr.mz);
            dr.mesh.visible = S.cutH > 2.2 || fx * (wx - P.x) + fz * (wz - P.z) > -0.15 || Math.abs(-fz * (wx - P.x) + fx * (wz - P.z)) > CUT_W;
          }
        }
        const pi = polyAt(S, lx, lz);
        const inPoly = pi >= 0 && S.polys[pi].cov && Math.abs(P.y - S.y0) < headroom;
        if (inPoly && Math.abs(P.y - (S.y0 + FLOOR_T)) < 0.5) sheltered = true;
        const ri = ringAt(S, lx, lz);
        const inRing = ri >= 0 && Math.abs(P.y - S.y0) < headroom;
        const underAny = under || inPoly || (inRing && S.rings[ri].roof) || inTower || (sameHome && homeUnder);
        if (inRing && S.rings[ri].roof && S.rings[ri].sides.every((t) => t) && Math.abs(P.y - (S.y0 + FLOOR_T)) < 0.5) ((sheltered = true), (cosy = Math.max(cosy, S.ringCosy[ri] || 0)));
        const target = B.on ? (roofsShown() ? 1 : 0) : underAny && !firstPerson ? 0 : 1;
        if (S.roofOp !== target) {
          S.roofOp = clamp(S.roofOp + Math.sign(target - S.roofOp) * dt * 4, 0, 1);
          S.roofMat.opacity = S.roofOp;
          for (const m of S.memMeshes) if (m.userData.roof) m.visible = S.roofOp > 0.5;
        }
        const room = S.cellRoom.get(ck(ci, cj));
        if (room && room.enclosed && room.roofed && Math.abs(P.y - (S.y0 + FLOOR_T)) < 0.5) ((sheltered = true), (cosy = Math.max(cosy, room.cosy || 0)));
        for (const dr of S.doors) {
          const want = Math.hypot(lx - dr.mx, lz - dr.mz) < dr.reach && !(P.dead > 0) ? 1 : 0;
          if (want && dr.open < 0.05) dr.dir = (lx - dr.mx) * dr.nx + (lz - dr.mz) * dr.nz > 0 ? 1 : -1;
          dr.open = clamp(dr.open + (want ? 1 : -1) * dt * 4.5, 0, 1);
          const ease = dr.open * dr.open * (3 - 2 * dr.open);
          dr.mesh.rotation.y = dr.base + dr.sign * dr.dir * ease * 1.75;
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
      fxDraw();
      frameView(dt);
      if (!B.on) return;
      if (B.camT > 0) {
        B.camT -= dt;
        const k = 1 - Math.exp(-9 * dt);
        G.cam.pitch += (1.12 - G.cam.pitch) * k;
        G.cam.dist += (Math.max(B.camSaved.dist, 27) - G.cam.dist) * k;
      }
      const turn = (G.keys.KeyQ ? 1 : 0) - (G.keys.KeyE && performance.now() - (B.eDown || 0) > 220 ? 1 : 0);
      if (turn) G.cam.yaw += turn * 1.9 * dt;
      // the hover is worked out again only when the pointer, the view or something built has moved
      const m = G.camera.matrixWorld.elements,
        sig = B.ptr.x * 7 + B.ptr.y * 13 + m[12] * 3 + m[13] * 5 + m[14] * 11 + m[0] * 17 + m[5] * 19 + m[10] * 23 + (B.ptr.inside ? 1 : 0) + B.version * 0.37 + B.selV * 0.11;
      if (sig !== B.sig || B.key === "" || B.move) {
        B.sig = sig;
        updateHover();
        updatePreview();
      }
      selDraw();
      settleTick(dt);
      if (ghostAdd.material.userData.hatch.value) ghostAdd.material.opacity = 0.5 + 0.12 * Math.sin(performance.now() * 0.008);
      else if (ghostAdd.material.opacity !== 0.5) ghostAdd.material.opacity = 0.5;
      B.frameHook && B.frameHook(dt);
    },
    reset() {
      for (const S of [...B.structs]) disposeStruct(S);
      B.seed = null;
      B.undo.length = B.redo.length = 0;
      B.drag = null;
      B.key = "";
      B.version++;
      B.sel = [];
      B.selV++;
      B.meas.length = 0;
      B.measA = null;
      fxRestore(null);
      touchUi();
    },
    // equipment (ARCHITECTURE.md, "Fixtures and connections")
    setFixtureCatalog(map) {
      FX.cat = map && Object.keys(map).length ? map : DEMO_FIXTURES;
      if (!FX.cat[FX.kind]) FX.kind = Object.keys(FX.cat)[0];
      FX.geo.clear();
      fxTouch();
    },
    fixtureCatalog: () => FX.cat,
    addFixtures: fxAdd,
    setFixtureSetting: fxSetting,
    connect: fxConnect,
    removeFixture(id) {
      const ok = fxRemove(id);
      ok && fxTouch();
      return ok;
    },
    port: fxPort,
    state: B,
    Geo,
    texel,
    shade,
    hash,
    col,
    save: saveBuilds,
    // for on-screen buttons
    cancel() {
      putDown(false);
      B.aim = false;
    },
    applyOp,
    computeOp,
    setTool,
    toLocal,
    toWorld,
  };
})();
