/* Landscape view: the yard by hand (key 6). A shovel to dig, carry and toss earth, a rake to level it, gravel, bark and
   sand to lay, lawn seed, stones to set (stepping stones, brick edging, dry-stone walls course by course, boulders) and
   nursery plants to put in holes you dig for them. Also draws everything the landscape holds wherever you are: the
   hand-shaped ground (holes, heaps, terraces, paths), the stones and the plants.
   Draws the simulation's landscape (sim.state.sys.landscape) and owns no truth of its own: every action is a
   landscape.* command. Reaches the game only through window.__game and the generic hands (window.__hands).
   Shared with the garden (src/garden-view.js): the shovel's gesture (window.__landscape.tools.shovel) and the shape of
   the ground (window.__landscape.relief).
   The ground: worked 30 cm squares are drawn as their own mesh, in tiles of 16 x 16 squares, and the terrain lets them
   show through (the engine's dig mask), so a hole can go below the terrain's surface. Grass is hidden on them and
   comes back when a sown lawn knits.
   Cost: nothing per frame while nothing changes; tiles, stones and plants are rebuilt only when the landscape's
   revision moves (checked four times a second). */
(() => {
  const G = window.__game, H = window.__hands;
  if (!G || !H || !G.sim || !G.sim.handlers.has('landscape.dig') || !G.earthwork || !G.landscape) return;
  const T = G.THREE, EW = G.earthwork, RD = G.landscape, $ = (id) => document.getElementById(id), canvas = $('view');
  const { SURFACES, THINGS, PLANTS, SCOOP_M3 } = RD, RC = RD;
  const CELL = 0.3, CS = G.chunkSize || 32;   // CELL: the garden's beds
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const L = () => G.sim.state.sys.landscape;
  const GS = () => G.sim.state.sys.garden;
  const stock = () => G.sim.state.sys.stock;
  const ITEMS = G.stock.ITEMS;
  const owns = (id) => stock().tools.includes(id);
  const have = (id) => stock().items[id] || 0;
  let dirty = true;
  const cmd = (name, p) => { const r = G.sim.commandNow(name, p); G.markStockDirty && G.markStockDirty(); dirty = true; return r; };
  const money = (v) => '$' + (Math.round(v * 100) / 100).toFixed(v % 1 ? 2 : 0);
  const grid = () => L().grid;
  const MAT_HEX = { gravel: 0xa49d90, bark: 0x6a412c, sand: 0xd8c79a, riverrock: 0x8c8478, crushed: 0x8a8a86, dg: 0xc4a57a, slate: 0x4f5a63, marble: 0xe6e3dc, lava: 0x7a3b2c, woodchips: 0xa47a4c };

  /* ================= the shape of the ground, for everyone ================= */
  // the earthwork heightfield: points 10 cm apart in tiles of 32 x 32 (src/sim/core/earthwork.js)
  const STEP = 0.1, TS = 32, WALL = RD.FLAG.WALL;
  function relief(x, z) {
    const g = grid();
    for (const k in g.tiles) return EW.reliefAt(g, x, z);   // anything dug at all
    return 0;
  }
  const surfaceAt = (x, z) => G.heightAt(x, z) + relief(x, z);
  G.setRelief(relief);
  G.surfaceAt = surfaceAt;

  // a garden bed's worked squares are drawn by the garden view (src/garden-view.js), with this relief added
  function bedTilledAt(x, z) {
    const g = GS();
    if (!g || !g.field) return false;
    for (const b of Object.values(g.field.groups)) {
      const ix = Math.floor((x - b.x0) / CELL), iz = Math.floor((z - b.z0) / CELL);
      if (ix >= 0 && iz >= 0 && ix < b.nx && iz < b.nz) { const c = b.cells[iz * b.nx + ix]; return c.till === undefined || c.till > 0; }
    }
    return false;
  }
  const bedTilled = (gx, gz) => bedTilledAt((gx + 0.5) * CELL, (gz + 0.5) * CELL);
  // a point worth drawing: worked (any surface but turf), moved more than a few millimetres, or marked
  const workedN = (t, n) => t.s[n] !== 0 || Math.abs(t.h[n]) >= 4 || (t.f[n] & ~WALL) !== 0;
  function workedAt(g, i, j) {
    const tx = Math.floor(i / TS), tz = Math.floor(j / TS), t = g.tiles[tx + ',' + tz];
    return !!t && workedN(t, (j - tz * TS) * TS + (i - tx * TS));
  }

  /* ================= the ground mesh: smooth, tile by tile ================= */
  const groundMat = new T.MeshLambertMaterial({ vertexColors: true });
  const tileViews = new Map();    // tile key -> { mesh, sig, quads }
  let drawnSeen = 0, maskDue = false;
  const drawn = new Set();         // quad keys drawn (for the grass and the dig mask)
  const qKey = (i, j) => (i + 100000) * 200000 + (j + 100000);
  const COL = {
    soil: new T.Color(0x5e4632), soilDry: new T.Color(0x86704f), damp: new T.Color(0x2b1f16), dirtDark: new T.Color(0x34251a), dirtMid: new T.Color(0x4c3726), dirtLight: new T.Color(0x67503a), crust: new T.Color(0x7c6750), grit: new T.Color(0x8a7660), wall: new T.Color(0x6a4a30), firm: new T.Color(0x76604a), sod: new T.Color(0x56732f), sodDark: new T.Color(0x3f5a26),
    sprout: new T.Color(0x6f9a3a), skirt: new T.Color(0x3d2c1f), liner: new T.Color(0x232526), fabric: new T.Color(0x2e2f2c), fabricLine: new T.Color(0x45463f),
    gravel: new T.Color(0xa49d90), gravelDark: new T.Color(0x6f6a62), bark: new T.Color(0x5a3626), barkLight: new T.Color(0x8a5a3a), sand: new T.Color(0xd8c79a),
    rock: new T.Color(0x8c8478), rockDark: new T.Color(0x5f5a52), subsoil: new T.Color(0x9a7348),
  };
  const BASE = {
    gravel: [0xa49d90, 0x6f6a62], riverrock: [0x8c8478, 0x5f5a52], bark: [0x8a5a3a, 0x5a3626], sand: [0xd8c79a, 0xc9b88a],
    crushed: [0x8a8a86, 0x6c6c69], dg: [0xc4a57a, 0xb08f64], slate: [0x4f5a63, 0x3d464e], marble: [0xe6e3dc, 0xcfcbc2], lava: [0x7a3b2c, 0x5a2a20], woodchips: [0xa47a4c, 0x7d5a36],
  };
  for (const k in BASE) BASE[k] = BASE[k].map((h) => new T.Color(h));
  const _c = new T.Color(), _c2 = new T.Color();
  // smooth value noise on the point grid (for patches of drier and darker earth, and lumps)
  const vnoise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
  const looseAt = (t, n) => (t.f[n] & EW.LOOSE_BIT) && t.s[n] !== 0;
  // fresh loose earth stands in lumps: real height, a centimetre or two, fading out where it thins to nothing
  const lumpOf = (t, n, i, j) => { if (!looseAt(t, n) || t.l[n] > 2) return 0; const k = clamp(t.h[n] / 30, 0, 1); return k * ((vnoise(i * 0.55 + 3, j * 0.55 + 9) - 0.5) * 0.028 + (hash(i * 3 + 1, j * 7 + 2) - 0.5) * 0.008); };
  // the colour of one point: its material grained by a fixed speckle, fabric or liner where bare, darker down a hole
  function pointColour(g, t, n, i, j, lifeH) {
    const r = hash(i * 7 + 3, j * 13 + 1), name = g.codes[t.s[n]], f = t.f[n], h = t.h[n] / 1000;
    if (BASE[name] && t.l[n] > 2) _c.copy(r < 0.45 ? BASE[name][1] : BASE[name][0]).multiplyScalar(0.88 + 0.22 * hash(i + 5, j * 3));
    else if (name === '') _c.copy(r < 0.4 ? COL.sodDark : COL.sod).multiplyScalar(0.9 + 0.15 * hash(i, j + 9));
    else if (f & RD.FLAG.LINER) _c.copy(COL.liner).multiplyScalar(0.85 + 0.3 * r);
    else if (f & RD.FLAG.FABRIC) _c.copy((i + j) % 2 ? COL.fabric : COL.fabricLine);
    else {
      // topsoil: dark and rich, in patches of two or three tones, grit and darker crumbs through it
      const n1 = vnoise(i * 0.23 + 1, j * 0.23 + 7), n2 = vnoise(i * 0.7 + 17, j * 0.7 + 5);
      _c.copy(COL.dirtDark).lerp(COL.dirtMid, n1).lerp(COL.dirtLight, n2 * 0.45);
      if (r < 0.07) _c.lerp(COL.grit, 0.6); else if (r > 0.93) _c.multiplyScalar(0.7);
      if (f & (RD.FLAG.TAMP1 | RD.FLAG.TAMP2)) _c.lerp(COL.firm, f & RD.FLAG.TAMP2 ? 0.6 : 0.3);   // tamped earth: smoother and paler
      if (name === 'lawn_sown') { const age = clamp((lifeH - t.t[n]) / (RD.LAWN.coverDays * 24), 0, 1); if (hash(i * 3 + 1, j * 5) < 0.15 + 0.85 * age) _c.lerp(COL.sprout, 0.35 + 0.5 * age); }
    }
    const bare = !(BASE[name] && t.l[n] > 2) && !(f & (RD.FLAG.LINER | RD.FLAG.FABRIC)) && name !== '';
    // A heap of fresh earth dries on top first: pale crusty patches where it stands highest and the wind gets it.
    // A hole is damp and in shade, darker the deeper, the lighter and redder subsoil showing in its walls.
    if (bare && (f & EW.LOOSE_BIT) && h > 0.04) { const dry = clamp((h - 0.04) * 2.2, 0, 0.55) * clamp(vnoise(i * 0.4 + 31, j * 0.4 + 2) * 1.6 - 0.3, 0, 1); _c.lerp(COL.crust, dry); }
    if (h < -0.03 && bare) {
      _c.lerp(COL.wall, clamp((-h - 0.05) * 3, 0, 0.45) * (0.6 + 0.4 * vnoise(i * 0.5, j * 0.5 + 40))).lerp(COL.damp, clamp(-h * 1.1, 0, 0.5));
      return _c.multiplyScalar(1 - clamp(-h * 1.1, 0, 0.45));
    }
    return _c.multiplyScalar(1 + clamp(h * 0.8, -0.25, 0));
  }
  const ptRef = (g, i, j) => { const tx = Math.floor(i / TS), tz = Math.floor(j / TS), t = g.tiles[tx + ',' + tz]; return t ? [t, (j - tz * TS) * TS + (i - tx * TS)] : null; };
  function buildTile(tx, tz, lifeH) {
    const g = grid(), i0 = tx * TS, j0 = tz * TS, W = TS + 3;
    // the world height of every point in the tile and one beyond, for smooth normals
    const Y = new Float32Array(W * W);
    for (let b = 0; b < W; b++) for (let a = 0; a < W; a++) { const i = i0 + a - 1, j = j0 + b - 1, x = i * STEP, z = j * STEP, r = ptRef(g, i, j); Y[b * W + a] = G.heightAt(x, z) + EW.hAt(g, i, j) + 0.004 + (r ? lumpOf(r[0], r[1], i, j) : 0); }
    const y = (i, j) => Y[(j - j0 + 1) * W + (i - i0 + 1)];
    const quadOn = (i, j) => (workedAt(g, i, j) || workedAt(g, i + 1, j) || workedAt(g, i, j + 1) || workedAt(g, i + 1, j + 1)) && !bedTilledAt((i + 0.5) * STEP, (j + 0.5) * STEP);
    const pos = [], nor = [], col = [], quads = [];
    const vert = (i, j, down = 0) => {
      const x = i * STEP, z = j * STEP, yy = y(i, j);
      pos.push(x, yy - down, z);
      const nx = (y(i - 1, j) - y(i + 1, j)) * 1.7, nz = (y(i, j - 1) - y(i, j + 1)) * 1.7, l = Math.hypot(nx, 2 * STEP, nz);   // shading a little stronger than true, so shapes read from above
      if (down) nor.push(0, 1, 0); else nor.push(nx / l, (2 * STEP) / l, nz / l);
      const r = ptRef(g, i, j), c = down ? _c2.copy(COL.skirt) : r ? pointColour(g, r[0], r[1], i, j, lifeH) : _c.copy(COL.sod);
      col.push(c.r, c.g, c.b);
    };
    for (let j = j0; j < j0 + TS; j++) for (let i = i0; i < i0 + TS; i++) {
      if (!quadOn(i, j)) continue;
      quads.push([i, j]);
      // two triangles split along the shorter diagonal
      if (Math.abs(y(i, j) - y(i + 1, j + 1)) < Math.abs(y(i + 1, j) - y(i, j + 1))) { vert(i, j); vert(i, j + 1); vert(i + 1, j + 1); vert(i, j); vert(i + 1, j + 1); vert(i + 1, j); }
      else { vert(i, j); vert(i, j + 1); vert(i + 1, j); vert(i + 1, j); vert(i, j + 1); vert(i + 1, j + 1); }
      // skirts where the quad meets ground drawn by the terrain or a bed: they hide hairlines between meshes
      const sk = (a1, b1, a2, b2) => { vert(a1, b1); vert(a1, b1, 0.25); vert(a2, b2); vert(a2, b2); vert(a1, b1, 0.25); vert(a2, b2, 0.25); };
      if (!quadOn(i, j - 1)) sk(i + 1, j, i, j);
      if (!quadOn(i, j + 1)) sk(i, j + 1, i + 1, j + 1);
      if (!quadOn(i - 1, j)) sk(i, j, i, j + 1);
      if (!quadOn(i + 1, j)) sk(i + 1, j + 1, i + 1, j);
    }
    if (!quads.length) return { mesh: null, quads };
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('normal', new T.BufferAttribute(new Float32Array(nor), 3));
    geo.setAttribute('color', new T.BufferAttribute(new Float32Array(col), 3));
    const m = new T.Mesh(geo, groundMat);
    m.receiveShadow = true; m.castShadow = true;
    const d = detailFor(g, quads, y);
    if (d) m.add(d);
    return { mesh: m, quads };
  }
  // Pieces scattered on laid surfaces (pebbles, cobbles, chips, flakes), and weeds coming up where they grow: a fixed
  // pattern per quad, built with the tile.
  const DETAIL = {
    gravel: { n: 1.0, geo: new T.OctahedronGeometry(1, 0), size: [0.018, 0.034], flat: 0.55, cols: [0xb5ada0, 0x8d877d, 0x6f6a62, 0xc8bfae] },
    riverrock: { n: 0.6, geo: new T.IcosahedronGeometry(1, 0), size: [0.04, 0.085], flat: 0.5, cols: [0x9a9286, 0x6d675e, 0xb3a690, 0x7d6d5a, 0x5c5f5c] },
    bark: { n: 0.9, geo: new T.BoxGeometry(2, 0.35, 1), size: [0.018, 0.034], flat: 1, cols: [0x6a412c, 0x8a5a3a, 0x4e2e1f] },
    crushed: { n: 1.2, geo: new T.TetrahedronGeometry(1, 0), size: [0.016, 0.03], flat: 0.8, cols: [0x9a9a96, 0x7a7a76, 0x5f5f5c, 0xb0afa9] },
    dg: { n: 0.7, geo: new T.OctahedronGeometry(1, 0), size: [0.006, 0.012], flat: 0.6, cols: [0xd2b38a, 0xa98761, 0xe0c8a2] },
    slate: { n: 1.0, geo: new T.BoxGeometry(2, 0.25, 1.4), size: [0.018, 0.032], flat: 1, cols: [0x56626c, 0x434d55, 0x6b7680, 0x3a4249] },
    marble: { n: 1.1, geo: new T.OctahedronGeometry(1, 0), size: [0.016, 0.028], flat: 0.7, cols: [0xf3f1ec, 0xe2ded6, 0xd6d2c9] },
    lava: { n: 0.8, geo: new T.IcosahedronGeometry(1, 0), size: [0.022, 0.04], flat: 0.75, cols: [0x7e3a2a, 0x5c2a20, 0x96503a, 0x45231c] },
    woodchips: { n: 1.1, geo: new T.BoxGeometry(2.4, 0.3, 0.8), size: [0.02, 0.04], flat: 1, cols: [0xc19a66, 0xa47a4c, 0x8a6238, 0xd8b588] },
    clod: { n: 1.4, geo: new T.IcosahedronGeometry(1, 0), size: [0.012, 0.04], flat: 0.8, cols: [0x3b2a1e, 0x4a3425, 0x56402d, 0x634a34, 0x2f2218, 0x6e543b, 0x765f47] },
    weed: { n: 1, geo: new T.ConeGeometry(0.6, 3, 3), size: [0.02, 0.035], flat: 1, cols: [0x4f7a2e, 0x5f8f36, 0x6b9a3c] },
  };
  for (const k in DETAIL) DETAIL[k].pos = DETAIL[k].geo.toNonIndexed().attributes.position.array;
  function detailFor(g, quads, y) {
    const pos = [], col = [];
    const scatter = (D, i, j, count, seed) => {
      const src = D.pos;
      for (let k = 0; k < count; k++) {
        const u = hash(i * 31 + k + seed, j * 17), v = hash(j * 29 + k, i * 13 + 7 + seed), x = (i + u) * STEP, z = (j + v) * STEP;
        const yy = y(i, j) * (1 - u) * (1 - v) + y(i + 1, j) * u * (1 - v) + y(i, j + 1) * (1 - u) * v + y(i + 1, j + 1) * u * v;
        const sz = D.size[0] + (D.size[1] - D.size[0]) * hash(k * 7 + i, j * 3 + seed), yaw = hash(i + k * 3, j + k) * 6.28, cy = Math.cos(yaw), sy = Math.sin(yaw);
        const cc = _c.setHex(D.cols[Math.floor(hash(k + i * 5, j * 11 + k) * D.cols.length)]), up = D === DETAIL.weed ? sz * 1.4 : D === DETAIL.clod ? sz * 0.15 : sz * D.flat * 0.3;   // clods sit half into the earth
        for (let q = 0; q < src.length; q += 3) {
          const lx = src[q] * sz, ly = src[q + 1] * sz * D.flat, lz = src[q + 2] * sz * 0.8;
          pos.push(x + lx * cy - lz * sy, yy + up + ly, z + lx * sy + lz * cy);
          col.push(cc.r, cc.g, cc.b);
        }
      }
    };
    for (const [i, j] of quads) {
      const r = ptRef(g, i, j);
      if (!r) continue;
      const [t, n] = r, D = DETAIL[g.codes[t.s[n]]];
      if (D && t.l[n] > 2) { const c = Math.floor(D.n) + (hash(i, j + 77) < D.n % 1 ? 1 : 0); if (c) scatter(D, i, j, c, 0); }
      else if ((t.f[n] & EW.LOOSE_BIT) && g.codes[t.s[n]] === 'soil' && t.h[n] > 15) { const C = DETAIL.clod; scatter(C, i, j, 1 + (hash(i, j + 77) < 0.5 ? 1 : 0) + (t.h[n] > 120 && hash(i + 9, j) < 0.3 ? 1 : 0), 3); }   // clods on thrown earth
      const wd = (t.f[n] >> 4) & 7;
      if (wd) scatter(DETAIL.weed, i, j, Math.min(4, wd), 5);
    }
    if (!pos.length) return null;
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('color', new T.BufferAttribute(new Float32Array(col), 3));
    geo.computeVertexNormals();
    const m = new T.Mesh(geo, groundMat); m.receiveShadow = true;
    return m;
  }
  let groundRev = -1, bedSigSeen = '', heightSig = '';
  function bedsSig() {
    const g = GS(); if (!g || !g.field) return '';
    let s = ''; for (const b of Object.values(g.field.groups)) { s += b.id + b.x0 + b.z0 + b.nx + b.nz; for (const c of b.cells) s += c.till === undefined ? 1 : c.till > 0 ? 1 : 0; }
    return s;
  }
  // which tiles changed since they were last built: a cheap fingerprint of each tile's arrays and its neighbours' edges
  const fp = (t) => { if (!t) return 0; let h = 0; for (let n = 0; n < t.h.length; n++) h = (h * 31 + t.h[n] * 7 + t.s[n] * 131 + t.l[n] * 3 + t.f[n] * 17) | 0; return h; };
  // `light`: just rebuild the changed tiles (several times a second while grains are landing); the mask and grass catch up
  function refreshGround(force, light) {
    const g = grid(), lifeH = Math.round(G.sim.state.lifeT / 3600), bs = bedsSig();
    const hs = G.world ? G.world.edits.size + ':' + Math.floor(lifeH / 72) : '';
    if (!force && g.rev === groundRev && bs === bedSigSeen && hs === heightSig) return false;
    groundRev = g.rev; bedSigSeen = bs; heightSig = hs;
    const keys = Object.keys(g.tiles), want = new Set(keys), prints = new Map();
    for (const k of keys) prints.set(k, fp(g.tiles[k]));
    for (const [key, v] of [...tileViews]) if (!want.has(key)) { if (v.mesh) { G.scene.remove(v.mesh); v.mesh.geometry.dispose(); for (const ch of v.mesh.children) ch.geometry.dispose(); } tileViews.delete(key); }
    for (const key of keys) {
      const [tx, tz] = key.split(',').map(Number);
      let sig = prints.get(key) + ':' + bs.length + ':' + hs;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) sig += ':' + (prints.get(tx + dx + ',' + (tz + dz)) || 0);
      const v = tileViews.get(key);
      if (v && v.sig === sig && !force) continue;
      if (v && v.mesh) { G.scene.remove(v.mesh); v.mesh.geometry.dispose(); for (const ch of v.mesh.children) ch.geometry.dispose(); }
      const b = buildTile(tx, tz, lifeH);
      if (b.mesh) G.scene.add(b.mesh);
      tileViews.set(key, { mesh: b.mesh, sig, quads: b.quads });
    }
    drawn.clear();
    for (const v of tileViews.values()) for (const [i, j] of v.quads) drawn.add(qKey(i, j));
    if (light) { if (drawn.size !== drawnSeen) { drawnSeen = drawn.size; maskDue = true; } return true; }
    drawnSeen = drawn.size; maskDue = false;
    paintMask(true);
    hideGrass(true);
    return true;
  }

  /* ================= the dig mask: where the terrain lets the shaped ground show ================= */
  const MN = 1024;
  const maskData = new Uint8Array(MN * MN);
  const maskTex = new T.DataTexture(maskData, MN, MN, T.RedFormat, T.UnsignedByteType);
  maskTex.magFilter = maskTex.minFilter = T.NearestFilter; maskTex.generateMipmaps = false;
  let maskI = 0, maskJ = 0, maskOn = false;
  function paintMask(force) {
    const P = G.player, ci = Math.floor(P.x / STEP), cj = Math.floor(P.z / STEP);
    const moved = Math.abs(ci - (maskI + MN / 2)) > 300 || Math.abs(cj - (maskJ + MN / 2)) > 300;
    if (!force && !moved) return;
    if (!drawn.size && !maskOn) return;
    maskI = ci - MN / 2; maskJ = cj - MN / 2;
    maskData.fill(0);
    for (const v of tileViews.values()) for (const [i, j] of v.quads) { const x = i - maskI, z = j - maskJ; if (x >= 0 && z >= 0 && x < MN && z < MN) maskData[z * MN + x] = 255; }
    maskTex.needsUpdate = true;
    G.digMask.win.value.set(maskI * STEP, maskJ * STEP, STEP, MN);
    if (!maskOn) { G.digMask.enable(maskTex); maskOn = true; }
  }

  /* ================= grass: hidden on worked ground, back when the turf is ================= */
  const ZERO = new T.Matrix4().makeScale(0, 0, 0);
  // a thin scatter of thrown earth over grass (the fringe of a heap): the grass still shows through it
  const thinAt = (i, j) => { const r = ptRef(grid(), i, j); if (!r) return false; const [t, n] = r; return looseAt(t, n) && t.h[n] < 25 && t.h[n] > -5 && !t.l[n] && hash(i * 5 + 1, j * 3) < 0.7; };
  const grassRec = new WeakMap();   // mesh -> { list, orig: Float32Array, hid: Set, ver }
  const chunkHas = new Set(); let chunkRev = -1;
  function hideGrass(force) {
    const chunks = G.world && G.world.chunks, g = grid();
    if (!chunks) return;
    if (chunkRev !== g.rev) {
      chunkRev = g.rev; chunkHas.clear();
      for (const k in g.tiles) { const [tx, tz] = k.split(',').map(Number); for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) chunkHas.add(Math.floor(((tx + a) * TS * STEP) / CS) + ',' + Math.floor(((tz + b) * TS * STEP) / CS)); }
    }
    for (const c of chunks.values()) {
      const near = chunkHas.has(Math.round(c.ox / CS) + ',' + Math.round(c.oz / CS));
      for (const [mesh, list] of [[c.grassMesh, c.grass], [c.flowerMesh, c.flowers]]) {
        if (!mesh || !list) continue;
        let rec = grassRec.get(mesh);
        if (!near && !(rec && rec.hid.size)) continue;
        const arr = mesh.instanceMatrix.array;
        if (!rec || rec.list !== list || rec.orig.length !== arr.length) { rec = { list, orig: new Float32Array(arr), hid: new Set(), ver: -1 }; grassRec.set(mesh, rec); }
        else if (rec.ver !== mesh.instanceMatrix.version) {
          for (let i = 0; i < list.length; i++) if (!rec.hid.has(i)) for (let j = 0; j < 16; j++) rec.orig[i * 16 + j] = arr[i * 16 + j];
        } else if (!force) continue;
        let n = 0;
        list.forEach((gr, i) => {
          // the grass round worked ground is trampled back too, so the work reads clearly
          const x = c.ox + gr.lx, z = c.oz + gr.lz, qi = Math.floor(x / STEP), qj = Math.floor(z / STEP);
          const hide = (drawn.has(qKey(qi, qj)) || drawn.has(qKey(qi + 1, qj)) || drawn.has(qKey(qi - 1, qj)) || drawn.has(qKey(qi, qj + 1)) || drawn.has(qKey(qi, qj - 1))) && !thinAt(qi, qj);
          if (hide && !rec.hid.has(i)) { mesh.setMatrixAt(i, ZERO); rec.hid.add(i); n++; }
          else if (!hide && rec.hid.has(i)) { for (let j = 0; j < 16; j++) arr[i * 16 + j] = rec.orig[i * 16 + j]; rec.hid.delete(i); n++; }
        });
        if (n) mesh.instanceMatrix.needsUpdate = true;
        rec.ver = mesh.instanceMatrix.version + (n ? 1 : 0);
      }
    }
  }

  /* ================= geometry helpers (parts merged into one coloured geometry) ================= */
  const M4 = new T.Matrix4(), Q = new T.Quaternion(), E3 = new T.Euler(), V3 = new T.Vector3(), SC = new T.Vector3();
  function part(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, jitter = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    M4.compose(V3.set(x, y, z), Q.setFromEuler(E3.set(rx, ry, rz, 'YXZ')), SC.set(sx, sy, sz));
    g.applyMatrix4(M4);
    const n = g.attributes.position.count, c = new Float32Array(n * 3), cl = new T.Color(color), p = g.attributes.position.array;
    if (jitter) {
      // lumpy: move each corner by a fixed amount that depends only on where it is, so shared corners stay shared
      for (let i = 0; i < n; i++) { const a = Math.round(p[i * 3] * 200), b = Math.round(p[i * 3 + 1] * 200), d = Math.round(p[i * 3 + 2] * 200); p[i * 3] += (hash(a + b, d) - 0.5) * jitter; p[i * 3 + 1] += (hash(b + d, a) - 0.5) * jitter; p[i * 3 + 2] += (hash(d + a, b) - 0.5) * jitter; }
    }
    for (let i = 0; i < n; i++) { const s = 0.92 + 0.16 * hash(i, n); c[i * 3] = cl.r * s; c[i * 3 + 1] = cl.g * s; c[i * 3 + 2] = cl.b * s; }
    g.setAttribute('color', new T.BufferAttribute(c, 3));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color') g.deleteAttribute(k);
    return g;
  }
  function merge(parts) {
    let n = 0; for (const p of parts) n += p.attributes.position.count;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0;
    for (const p of parts) { pos.set(p.attributes.position.array, o); col.set(p.attributes.color.array, o); o += p.attributes.position.count * 3; p.dispose(); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }
  const ball = (r, d = 1) => new T.IcosahedronGeometry(r, d);
  const box = (w, h, d, s = 1) => new T.BoxGeometry(w, h, d, s, s, s);
  const stick = (h, r, sides = 5) => { const g = new T.CylinderGeometry(r * 0.75, r, h, sides); g.translate(0, h / 2, 0); return g; };
  const cone = (h, r, sides = 6) => { const g = new T.ConeGeometry(r, h, sides); g.translate(0, h / 2, 0); return g; };

  /* ================= stones ================= */
  // each kind built with its base at y = 0, its width along x and depth along z
  function stoneGeo(kind) {
    const d = THINGS[kind].dims;
    if (kind === 'flagstone') { const g = new T.CylinderGeometry(0.5, 0.5, 1, 7, 1); g.translate(0, 0.5, 0); return merge([part(g, 0xb9a988, 0, 0, 0, 0, 0.2, 0, d.w, d.h, d.d, 0.012)]); }
    if (kind === 'paver') return merge([part(box(d.w, d.h, d.d), 0xa65a3f, 0, d.h / 2, 0), part(box(d.w * 0.96, 0.004, d.d * 0.92), 0xb86a4c, 0, d.h + 0.001, 0)]);
    if (kind === 'wallstone') return merge([part(box(d.w, d.h, d.d, 2), 0x8f887a, 0, d.h / 2, 0, 0, 0, 0, 1, 1, 1, 0.035)]);
    if (kind === 'cobble') return merge([part(box(d.w, d.h, d.d, 2), 0x8d8a85, 0, d.h / 2, 0, 0, 0, 0, 1, 1, 1, 0.012), part(ball(0.5, 1), 0x9a9690, 0, d.h - 0.004, 0, 0, 0, 0, d.w * 0.92, 0.025, d.d * 0.92)]);
    if (kind === 'cutstone') return merge([part(box(d.w, d.h, d.d, 2), 0xc2a77e, 0, d.h / 2, 0, 0, 0, 0, 1, 1, 1, 0.008), part(box(d.w * 1.002, 0.006, d.d * 1.002), 0xa98f68, 0, d.h - 0.002, 0)]);
    if (kind === 'capstone') return merge([part(box(d.w, d.h, d.d, 2), 0xb39a76, 0, d.h / 2, 0, 0, 0, 0, 1, 1, 1, 0.006), part(box(d.w * 1.004, 0.004, d.d * 1.004), 0xc9b08a, 0, d.h, 0)]);
    if (kind === 'curb') return merge([part(box(d.w, d.h, d.d), 0x8f8f8c, 0, d.h / 2, 0), part(box(d.w * 1.002, 0.004, d.d * 0.9), 0xa3a3a0, 0, d.h, 0)]);
    if (kind === 'timber') return merge([part(box(d.w, d.h, d.d), 0x7a6146, 0, d.h / 2, 0), part(box(d.w * 0.98, 0.004, d.d * 0.7), 0x8d7152, 0, d.h + 0.001, 0), part(box(0.004, d.h * 0.9, d.d * 0.9), 0xa88b66, d.w / 2 + 0.001, d.h / 2, 0), part(box(0.004, d.h * 0.9, d.d * 0.9), 0xa88b66, -d.w / 2 - 0.001, d.h / 2, 0)]);
    if (kind === 'gardenbox') {
      const t = 0.04, w = d.w, dd = d.d, h = d.h, cedar = 0xa8683f, dark = 0x8c5532;
      return merge([part(box(w, h, t), cedar, 0, h / 2, dd / 2 - t / 2), part(box(w, h, t), cedar, 0, h / 2, -dd / 2 + t / 2), part(box(t, h, dd), dark, w / 2 - t / 2, h / 2, 0), part(box(t, h, dd), dark, -w / 2 + t / 2, h / 2, 0),
        part(box(w, 0.012, 0.012), dark, 0, h * 0.5, dd / 2 + 0.002), part(box(w, 0.012, 0.012), dark, 0, h * 0.5, -dd / 2 - 0.002),
        ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => part(box(0.07, h + 0.03, 0.07), dark, a * (w / 2 - 0.035), (h + 0.03) / 2, b * (dd / 2 - 0.035)))]);
    }
    if (kind === 'bag') {
      // a plastic sack lying flat, plump in the middle, a darker printed band; tinted per material by the instance colour
      return merge([part(ball(0.5, 2), 0xe6e6e0, 0, d.h * 0.5, 0, 0, 0, 0, d.w, d.h, d.d, 0.02), part(box(d.w * 0.82, d.h * 0.5, 0.06), 0x9a9a92, 0, d.h * 0.62, 0), part(box(0.05, d.h * 0.4, d.d * 0.9), 0xcfcfc8, d.w * 0.47, d.h * 0.4, 0)]);
    }
    if (kind === 'pathlight') return merge([part(stick(d.h - 0.06, 0.012, 5), 0x2c2c2a, 0, 0, 0), part(new T.CylinderGeometry(0.05, 0.045, 0.06, 8), 0x3a3a38, 0, d.h - 0.06, 0), part(new T.CylinderGeometry(0.065, 0.06, 0.015, 8), 0x2c2c2a, 0, d.h + 0.005, 0)]);
    return merge([part(ball(0.5, 1), 0x7d7a72, 0, d.h * 0.5, 0, 0, 0, 0, d.w, d.h, d.d, 0.12)]);
  }
  const stoneMat = new T.MeshLambertMaterial({ vertexColors: true });
  const stones = {};
  for (const k of Object.keys(THINGS)) {
    const m = new T.InstancedMesh(stoneGeo(k), stoneMat, 64);
    m.count = 0; m.castShadow = m.receiveShadow = true; m.frustumCulled = false; G.scene.add(m);
    stones[k] = m;
  }
  const _m = new T.Matrix4(), _p = new T.Vector3(), _q = new T.Quaternion(), _e = new T.Euler(), _s = new T.Vector3(), _ic = new T.Color();
  // the glowing part of the path lights: bright enough at night for the bloom to catch, dark by day
  const lensMat = new T.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  let lenses = new T.InstancedMesh(new T.CylinderGeometry(0.042, 0.04, 0.045, 8), lensMat, 16);
  lenses.count = 0; lenses.frustumCulled = false; G.scene.add(lenses);
  const LENS = new T.Color(1.9, 1.45, 0.9);
  let stoneSig = '';
  const _bagC = new T.Color(0x56703a);
  const stoneY = (o) => G.heightAt(o.ax, o.az) + o.y;
  function layoutStones() {
    const list = Object.values(L().things);
    let sig = list.length + ':' + L().nextId + ':' + grid().rev + ':';
    sig += heightSig;
    if (sig === stoneSig) return;
    stoneSig = sig;
    const by = {}; for (const k in stones) by[k] = [];
    for (const o of list) if (by[o.k]) by[o.k].push(o);
    for (const k in stones) {
      let m = stones[k];
      const arr = by[k];
      if (arr.length > m.instanceMatrix.count) {
        G.scene.remove(m);
        const cap = Math.max(arr.length + 32, m.instanceMatrix.count * 2);
        m = stones[k] = new T.InstancedMesh(m.geometry, stoneMat, cap);
        m.castShadow = m.receiveShadow = true; m.frustumCulled = false; G.scene.add(m);
      }
      arr.forEach((o, i) => {
        const n = +o.id.slice(1), sc = 0.9 + 0.2 * hash(n, 3);
        _m.compose(_p.set(o.x, stoneY(o), o.z), _q.setFromEuler(_e.set(0, o.yaw + (hash(n, 9) - 0.5) * 0.15, 0)), _s.set(sc, k === 'paver' ? 1 : 0.9 + 0.2 * hash(n, 5), sc));
        m.setMatrixAt(i, _m);
        if (k === 'bag') m.setColorAt(i, _ic.setHex(o.m === 'bedmix' ? 0x6b5a3a : matHex(o.m)).lerp(_bagC, 0.45));
        else m.setColorAt(i, _ic.setScalar(0.85 + 0.3 * hash(n, 7)));
      });
      m.count = arr.length; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    const lights = by.pathlight || [];
    if (lights.length > lenses.instanceMatrix.count) { G.scene.remove(lenses); lenses = new T.InstancedMesh(lenses.geometry, lensMat, lights.length + 16); lenses.frustumCulled = false; G.scene.add(lenses); }
    lights.forEach((o, i) => { _m.compose(_p.set(o.x, stoneY(o) + THINGS.pathlight.dims.h - 0.06 + 0.03, o.z), _q.identity(), _s.set(1, 1, 1)); lenses.setMatrixAt(i, _m); });
    lenses.count = lights.length; lenses.instanceMatrix.needsUpdate = true;
  }

  /* ================= nursery plants: built in code at unit size (1 m tall, 1 m across), scaled as they grow ================= */
  function plantGeo(look) {
    const P = [];
    const r = (i, s) => hash(i * 17 + s, s * 31 + 5);
    if (look === 'lavender') {
      P.push(part(ball(0.5, 1), 0x7f9277, 0, 0.22, 0, 0, 0, 0, 0.9, 0.45, 0.9, 0.08));
      for (let i = 0; i < 18; i++) {
        const a = r(i, 1) * 6.28, d = 0.35 * Math.sqrt(r(i, 2)), lean = 0.25 * d / 0.35;
        P.push(part(stick(0.55, 0.012, 3), 0x8aa07c, Math.sin(a) * d, 0.3, Math.cos(a) * d, Math.cos(a) * lean, 0, -Math.sin(a) * lean));
        P.push(part(cone(0.22, 0.04, 5), 0x7b5fb4, Math.sin(a) * (d + 0.15 * lean), 0.82, Math.cos(a) * (d + 0.15 * lean), Math.cos(a) * lean, 0, -Math.sin(a) * lean));
      }
    } else if (look === 'daisy') {
      P.push(part(ball(0.5, 1), 0x4f7a32, 0, 0.3, 0, 0, 0, 0, 0.95, 0.6, 0.95, 0.08));
      for (let i = 0; i < 16; i++) {
        const a = r(i, 1) * 6.28, d = 0.38 * Math.sqrt(r(i, 2)), y = 0.62 + 0.3 * r(i, 3);
        P.push(part(new T.CylinderGeometry(0.08, 0.06, 0.02, 9), 0xe8b52a, Math.sin(a) * d, y, Math.cos(a) * d, 0.3 * (r(i, 4) - 0.5), 0, 0.3 * (r(i, 5) - 0.5)));
        P.push(part(ball(0.03, 0), 0x3a2516, Math.sin(a) * d, y + 0.02, Math.cos(a) * d));
      }
    } else if (look === 'grass') {
      for (let i = 0; i < 26; i++) {
        const a = r(i, 1) * 6.28, d = 0.12 * Math.sqrt(r(i, 2)), lean = 0.08 + 0.18 * r(i, 3);
        P.push(part(cone(0.75, 0.025, 3), 0x6f8a3e, Math.sin(a) * d, 0, Math.cos(a) * d, Math.cos(a) * lean, 0, -Math.sin(a) * lean));
      }
      for (let i = 0; i < 12; i++) {
        const a = r(i, 6) * 6.28, d = 0.08 * Math.sqrt(r(i, 7)), lean = 0.05 + 0.08 * r(i, 8);
        P.push(part(stick(0.95, 0.008, 3), 0xb7a26a, Math.sin(a) * d, 0, Math.cos(a) * d, Math.cos(a) * lean, 0, -Math.sin(a) * lean));
        P.push(part(cone(0.24, 0.03, 4), 0xd2bf86, Math.sin(a) * (d + 0.95 * lean), 0.78, Math.cos(a) * (d + 0.95 * lean), Math.cos(a) * lean, 0, -Math.sin(a) * lean));
      }
    } else if (look === 'ball') {
      P.push(part(ball(0.5, 2), 0x2f5528, 0, 0.5, 0, 0, 0, 0, 1, 1, 1, 0.07));
      for (let i = 0; i < 10; i++) { const a = r(i, 1) * 6.28, y = 0.25 + 0.55 * r(i, 2), d = 0.42; P.push(part(ball(0.12, 0), 0x3d6a31, Math.sin(a) * d, y, Math.cos(a) * d)); }
    } else if (look === 'hydrangea' || look === 'rose') {
      const leaf = look === 'rose' ? 0x355f2c : 0x4f7d39, fl = look === 'rose' ? 0xc4243a : 0xf1f0e2, n = look === 'rose' ? 22 : 9, fr = look === 'rose' ? 0.055 : 0.14;
      P.push(part(ball(0.5, 1), leaf, 0, 0.45, 0, 0, 0, 0, 1, 0.9, 1, 0.12));
      P.push(part(ball(0.32, 1), leaf, 0.18, 0.62, -0.1, 0, 0, 0, 1, 1, 1, 0.08));
      for (let i = 0; i < n; i++) {
        const a = r(i, 1) * 6.28, up = 0.15 + 0.85 * r(i, 2), d = 0.46 * Math.sqrt(1 - up * up * 0.6);
        P.push(part(ball(fr * (0.8 + 0.4 * r(i, 3)), 1), fl, Math.sin(a) * d, 0.42 + 0.48 * up, Math.cos(a) * d, 0, 0, 0, 1, 0.85, 1, fr * 0.3));
      }
    } else if (look === 'blueberry') {
      for (let i = 0; i < 7; i++) { const a = r(i, 1) * 6.28, d = 0.12 * r(i, 2); P.push(part(stick(0.7, 0.012, 4), 0x6b4a36, Math.sin(a) * d, 0, Math.cos(a) * d, Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25)); }
      P.push(part(ball(0.5, 1), 0x3f6b33, 0, 0.55, 0, 0, 0, 0, 1, 0.8, 1, 0.12));
      P.push(part(ball(0.3, 1), 0x4c7a3a, 0.15, 0.78, 0.1, 0, 0, 0, 1, 0.8, 1, 0.08));
      for (let i = 0; i < 30; i++) { const a = r(i, 3) * 6.28, up = r(i, 4), d = 0.47 * Math.sqrt(1 - up * up * 0.5); P.push(part(ball(0.022, 0), i % 4 ? 0x3d4d8c : 0x5866a8, Math.sin(a) * d, 0.4 + 0.42 * up, Math.cos(a) * d)); }
    } else if (look === 'apple') {
      P.push(part(stick(0.42, 0.04, 6), 0x5a4232, 0, 0, 0));
      for (const [a, l] of [[0.3, 0.32], [2.2, 0.3], [4.1, 0.34]]) P.push(part(stick(l, 0.022, 5), 0x5a4232, 0, 0.36, 0, Math.cos(a) * 0.9, 0, -Math.sin(a) * 0.9));
      P.push(part(ball(0.42, 1), 0x4f7f34, 0, 0.66, 0, 0, 0, 0, 1.1, 0.75, 1.1, 0.1));
      P.push(part(ball(0.25, 1), 0x5a8a3c, 0.2, 0.84, -0.1, 0, 0, 0, 1, 0.8, 1, 0.07));
      for (let i = 0; i < 16; i++) { const a = r(i, 5) * 6.28, up = r(i, 6), d = 0.44 * Math.sqrt(1 - up * up * 0.6); P.push(part(ball(0.035, 1), i % 3 ? 0xc0392b : 0xd9a22e, Math.sin(a) * d, 0.5 + 0.35 * up, Math.cos(a) * d)); }
    } else if (look === 'iris') {
      for (let i = 0; i < 14; i++) { const a = r(i, 1) * 6.28, lean = 0.05 + 0.15 * r(i, 2); P.push(part(cone(0.85 + 0.15 * r(i, 3), 0.03, 3), 0x5b8a3a, Math.sin(a) * 0.05, 0, Math.cos(a) * 0.05, Math.cos(a) * lean, a, -Math.sin(a) * lean, 1, 1, 0.35)); }
      for (let i = 0; i < 4; i++) { const a = r(i, 4) * 6.28, d = 0.08; P.push(part(stick(0.75, 0.008, 3), 0x5b8a3a, Math.sin(a) * d, 0, Math.cos(a) * d)); P.push(part(ball(0.06, 0), 0xf2d02a, Math.sin(a) * d, 0.78, Math.cos(a) * d, 0, 0, 0, 1.2, 0.7, 1.2)); }
    } else if (look === 'maple') {
      P.push(part(stick(0.5, 0.035, 6), 0x4a3426, 0, 0, 0));
      for (const [a, l] of [[0.4, 0.5], [2.4, 0.45], [4.3, 0.5]]) P.push(part(stick(l, 0.02, 5), 0x4a3426, 0, 0.42, 0, Math.cos(a) * 0.7, 0, -Math.sin(a) * 0.7));
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * 6.28 + r(i, 1), d = 0.18 + 0.22 * r(i, 2), y = 0.55 + 0.25 * r(i, 3);
        P.push(part(ball(0.22, 1), i % 3 ? 0x8e1f22 : 0xa8302a, Math.sin(a) * d, y, Math.cos(a) * d, 0, 0, 0, 1.1, 0.55, 1.1, 0.06));
      }
      P.push(part(ball(0.3, 1), 0x7e1c20, 0, 0.82, 0, 0, 0, 0, 1.2, 0.5, 1.2, 0.06));
    }
    return merge(P);
  }
  const plantMat = new T.MeshLambertMaterial({ vertexColors: true });
  const plantMeshes = {};
  const plantGeos = {};
  for (const k of Object.keys(PLANTS)) {
    const look = PLANTS[k].look;
    plantGeos[look] = plantGeos[look] || plantGeo(look);
    const m = new T.InstancedMesh(plantGeos[look], plantMat, 32);
    m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; G.scene.add(m);
    plantMeshes[k] = m;
  }
  let plantSig = '', plantT = 0;
  function layoutPlants(force) {
    const list = Object.values(L().plants), lifeT = G.sim.state.lifeT;
    let sig = list.length + ':' + heightSig + ':'; for (const p of list) sig += p.id + (p.w < RD.ESTABLISH.wiltAt ? 'w' : '') + ',';
    if (sig === plantSig && !force) return;
    plantSig = sig;
    const by = {}; for (const k in plantMeshes) by[k] = [];
    for (const p of list) if (by[p.k]) by[p.k].push(p);
    for (const k in plantMeshes) {
      let m = plantMeshes[k];
      const arr = by[k];
      if (arr.length > m.instanceMatrix.count) {
        G.scene.remove(m);
        m = plantMeshes[k] = new T.InstancedMesh(m.geometry, plantMat, arr.length + 16);
        m.castShadow = m.receiveShadow = true; m.frustumCulled = false; G.scene.add(m);
      }
      arr.forEach((p, i) => {
        const z = RD.plantSize(G.sim.state, p.id, lifeT), n = +p.id.slice(1), v = 0.9 + 0.2 * hash(n, 4);
        _m.compose(_p.set(p.x, surfaceAt(p.x, p.z) - 0.02, p.z), _q.setFromEuler(_e.set(0, p.yaw, 0)), _s.set(z.w * v, z.h * (0.92 + 0.16 * hash(n, 6)), z.w * v));
        m.setMatrixAt(i, _m);
        m.setColorAt(i, z.wilt ? _ic.setRGB(0.85, 0.72, 0.45) : _ic.setRGB(1, 1, 1));   // a dry plant goes dull and yellow
      });
      m.count = arr.length; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  /* ================= ponds: a flat sheet of water at the level the simulation finds ================= */
  const pondMat = new T.MeshPhongMaterial({ color: 0x24403f, specular: 0x8fb4bd, shininess: 120, transparent: true, opacity: 0.84, depthWrite: false });
  const pondViews = new Map();   // root -> { mesh, sig }
  const hoseMeshes = new Map();
  const hoseGeo = merge([part(new T.TorusGeometry(0.16, 0.02, 5, 14), 0x2f7a3a, 0, 0.03, 0, Math.PI / 2, 0, 0), part(new T.TorusGeometry(0.12, 0.02, 5, 12), 0x2f7a3a, 0, 0.07, 0, Math.PI / 2, 0, 0), part(stick(0.25, 0.012, 4), 0x2f7a3a, 0.16, 0.05, 0, 0, 0, -1.2)]);
  const pondTop = (pd) => { let s = 0; for (const [i, j] of pd.pts) s += G.heightAt(i * STEP, j * STEP); return s / pd.pts.length + pd.level; };
  function layoutPonds() {
    const list = RD.pondsOf(G.sim.state), seen = new Set();
    for (const pd of list) {
      seen.add(pd.root);
      const sig = pd.pts.length + ':' + Math.round(pd.m3 * 200) + ':' + groundRev;
      let v = pondViews.get(pd.root);
      if (!v || v.sig !== sig) {
        if (v && v.mesh) { G.scene.remove(v.mesh); v.mesh.geometry.dispose(); }
        let mesh = null;
        if (pd.m3 > 1e-4) {
          const y = pondTop(pd) + 0.002, pos = [], g = grid();
          for (const [i, j] of pd.pts) {
            if (EW.hAt(g, i, j) >= pd.level - 0.002) continue;
            const x0 = (i - 0.6) * STEP, x1 = (i + 0.6) * STEP, z0 = (j - 0.6) * STEP, z1 = (j + 0.6) * STEP;
            pos.push(x0, y, z0, x0, y, z1, x1, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
          }
          if (pos.length) {
            const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3)); geo.computeVertexNormals();
            mesh = new T.Mesh(geo, pondMat); mesh.renderOrder = 3; mesh.receiveShadow = true; G.scene.add(mesh);
          }
        }
        pondViews.set(pd.root, (v = { mesh, sig }));
      }
      // a hose coiled at the rim while it runs
      let h = hoseMeshes.get(pd.root);
      if (pd.hose && !h) {
        const [gi, gj] = pd.pts[0], x = gi * STEP - 0.2, z = gj * STEP - 0.2;
        h = new T.Mesh(hoseGeo, plantMat); h.position.set(x, surfaceAt(x, z), z); G.scene.add(h); hoseMeshes.set(pd.root, h); h.userData.pd = pd;
      } else if (!pd.hose && h) { G.scene.remove(h); hoseMeshes.delete(pd.root); }
      if (h) h.userData.pd = pd;
    }
    for (const [r, v] of [...pondViews]) if (!seen.has(r)) { if (v.mesh) { G.scene.remove(v.mesh); v.mesh.geometry.dispose(); } pondViews.delete(r); }
    for (const [r, h] of [...hoseMeshes]) if (!seen.has(r)) { G.scene.remove(h); hoseMeshes.delete(r); }
  }
  // the hose's stream, a few drops a frame into the pond
  function hoseSpray() {
    for (const h of hoseMeshes.values()) {
      const pd = h.userData.pd, [gi, gj] = pd.pts[0], x = gi * STEP, z = gj * STEP;
      if (Math.random() < 0.5) G.burst(x, pondTop(pd) + 0.05, z, 2, 0xcfeaf7, 0.6, 0.6, 0.03, 0.35);
    }
  }

  /* ================= what the hands hold ================= */
  const toolMat = new T.MeshLambertMaterial({ vertexColors: true });
  const mesh = (parts) => { const m = new T.Mesh(merge(parts), toolMat); m.castShadow = true; return m; };
  const ITEM = {};
  // the shovel: blade tip at the origin, handle up +y; a heap on the blade when loaded
  {
    const blade = new T.CylinderGeometry(0.15, 0.13, 0.3, 8, 1, false, -0.9, 1.8);
    const obj = mesh([part(stick(1.25, 0.022, 6), 0xc9975a, 0, 0.27, -0.02), part(box(0.16, 0.05, 0.05), 0x2b2b2b, 0, 1.5, -0.02), part(blade, 0x7b858c, 0, 0.15, 0.08, 0, Math.PI, 0, 1, 1, 0.5), part(box(0.05, 0.12, 0.04), 0x5d666c, 0, 0.32, -0.02)]);
    const heap = new T.Mesh(ball(0.12, 1), new T.MeshLambertMaterial({ color: 0x5e4632 }));
    heap.scale.set(1, 0.55, 1); heap.position.set(0, 0.16, 0.06); heap.visible = false; obj.add(heap);
    ITEM.shovel = { obj, heap, use: 'tip', still: [0.42, 0.02, 0.2, 0, 0, 0], stillArm: -0.5, walk: [0.3, 1.74, -0.78, 2.15, 0, 0], walkArm: -1.0 };
  }
  ITEM.rake = { obj: mesh([part(stick(1.6, 0.02, 6), 0xc9975a, 0, 0.03, 0), part(box(0.46, 0.03, 0.04), 0x6d767c, 0, 0.03, 0.02), ...Array.from({ length: 12 }, (_, i) => part(box(0.012, 0.08, 0.012), 0x6d767c, -0.21 + i * 0.038, 0.0, 0.05))]),
    use: 'tip', still: [0.44, 0.02, 0.22, 0, 0, 0], stillArm: -0.5, walk: [0.3, 1.74, -0.78, 2.15, 0, 0], walkArm: -1.0 };
  const bucket = (fill) => ({ obj: mesh([part(new T.CylinderGeometry(0.2, 0.16, 0.28, 10), 0x6e7b52, 0, 0.14, 0), part(ball(0.19, 1), fill, 0, 0.28, 0, 0, 0, 0, 1, 0.55, 1)]), use: 'over', overD: 0.55, overH: 0.8, tiltHold: 0.9, tiltMax: 0.35, still: [0.4, 0.5, 0.12, 0, 0, 0], stillArm: -0.15 });
  ITEM.gravel = bucket(0xa49d90); ITEM.bark = bucket(0x6a412c); ITEM.sand = bucket(0xd8c79a); ITEM.seed = bucket(0xd9cf9a); ITEM.riverrock = bucket(0x8c8478);
  for (const k of ['crushed', 'dg', 'slate', 'marble', 'lava']) ITEM[k] = bucket(MAT_HEX[k]);
  ITEM.woodchips = bucket(MAT_HEX.woodchips);
  // the wheelbarrow: tray, one wheel, two handles; a heap in the tray as it fills
  {
    const tray = new T.CylinderGeometry(0.42, 0.3, 0.26, 4, 1, true); tray.rotateY(Math.PI / 4);
    const obj = mesh([part(tray, 0x2f6e8e, 0, 0.38, 0, 0, 0, 0, 1, 1, 1.35), part(box(0.5, 0.02, 0.6), 0x2a5f7a, 0, 0.25, 0), part(new T.CylinderGeometry(0.17, 0.17, 0.09, 12), 0x222222, 0, 0.17, 0.62, 0, 0, Math.PI / 2), part(stick(1.3, 0.02, 5), 0x8a6a45, 0.22, 0.2, 0.55, -1.42, 0, 0), part(stick(1.3, 0.02, 5), 0x8a6a45, -0.22, 0.2, 0.55, -1.42, 0, 0), part(stick(0.22, 0.015, 4), 0x444444, 0.2, 0, -0.25), part(stick(0.22, 0.015, 4), 0x444444, -0.2, 0, -0.25)]);
    obj.scale.setScalar(0.8); obj.rotation.y = Math.PI;
    const heap = new T.Mesh(ball(0.3, 1), new T.MeshLambertMaterial({ color: 0x5e4632 })); heap.position.set(0, 0.42, 0); heap.visible = false; obj.add(heap);
    const g = new T.Group(); g.add(obj);
    ITEM.barrow = { obj: g, heap, use: 'hand', still: [0, 0.05, 0.65, 0, 0, 0], reach: [0, 0.05, 0.75, 0, 0, 0], stillArm: -0.4 };
  }
  ITEM.tamper = { obj: mesh([part(stick(1.2, 0.018, 6), 0x3c3c3a, 0, 0.03, 0), part(box(0.2, 0.025, 0.2), 0x4a4d50, 0, 0.012, 0), part(box(0.16, 0.03, 0.03), 0x2a2a2a, 0, 1.22, 0)]), use: 'tip', still: [0.38, 0.02, 0.24, 0, 0, 0], stillArm: -0.5, walk: [0.3, 1.74, -0.78, 2.15, 0, 0], walkArm: -1.0 };
  ITEM.fabric = { obj: mesh([part(new T.CylinderGeometry(0.07, 0.07, 0.7, 10), 0x2e2f2c, 0, 0, 0, 0, 0, Math.PI / 2), part(box(0.6, 0.004, 0.4), 0x3a3b37, 0, -0.07, 0.2)]), use: 'hand', still: [0, 0.6, 0.35, 0, 0, 0], reach: [0, 0.35, 0.55, 0, 0, 0], stillArm: -1.1 };
  ITEM.bedmix = { obj: mesh([part(box(0.36, 0.5, 0.18), 0x3f6a3a, 0, 0.25, 0), part(box(0.3, 0.1, 0.19), 0xd8c88a, 0, 0.3, 0)]), use: 'over', overD: 0.55, overH: 0.8, tiltHold: 0.9, tiltMax: 0.35, still: [0.4, 0.5, 0.12, 0, 0, 0], stillArm: -0.15 };
  ITEM.liner = { obj: mesh([part(new T.CylinderGeometry(0.09, 0.09, 0.6, 10), 0x1f2122, 0, 0, 0, 0, 0, Math.PI / 2), part(box(0.5, 0.004, 0.3), 0x2a2c2d, 0, -0.09, 0.15)]), use: 'hand', still: [0, 0.75, 0.3, 0, 0, 0], reach: [0, 0.5, 0.5, 0, 0, 0], stillArm: -1.1 };
  ITEM.hose = { obj: new T.Group(), use: 'hand', still: [0, 0.7, 0.3, 0, 0, 0], stillArm: -1.1 };
  ITEM.hose.obj.add(new T.Mesh(merge([part(new T.TorusGeometry(0.16, 0.02, 5, 14), 0x2f7a3a, 0, 0, 0), part(new T.TorusGeometry(0.12, 0.02, 5, 12), 0x2f7a3a, 0, 0, 0.03)]), toolMat));
  for (const k of Object.keys(THINGS)) {
    const o = new T.Mesh(stones[k].geometry, stoneMat); o.castShadow = true;
    const s = k === 'boulder' ? 0.5 : k === 'paver' ? 1.6 : 1;
    o.scale.setScalar(s);
    const g = new T.Group(); g.add(o);
    ITEM[k] = { obj: g, use: 'hand', still: [0, 0.75, 0.32, 0, 0, 0], reach: [0, 0.6, 0.55, 0, 0, 0], stillArm: -1.1 };
  }
  for (const k of Object.keys(PLANTS)) {
    const pot = part(new T.CylinderGeometry(0.11, 0.08, 0.18, 10), 0x9a5a3a, 0, 0.09, 0);
    const g = new T.Group(); g.add(new T.Mesh(merge([pot]), toolMat));
    const p = new T.Mesh(plantGeos[PLANTS[k].look], plantMat); p.scale.set(0.32, 0.38, 0.32); p.position.y = 0.17; g.add(p);
    ITEM['plant:' + k] = { obj: g, use: 'hand', still: [0, 0.6, 0.32, 0, 0, 0], reach: [0, 0.45, 0.5, 0, 0, 0], stillArm: -1.1 };
  }

  /* ================= the ghost: where a stone will go ================= */
  const ghostMat = new T.MeshLambertMaterial({ color: 0xfff2c4, transparent: true, opacity: 0.45, depthWrite: false });
  const ghost = new T.Mesh(stones.flagstone.geometry, ghostMat); ghost.visible = false; ghost.renderOrder = 9; G.scene.add(ghost);
  let ghostYaw = 0;
  // where a stone of this kind would sit at (x, z): on top of a course below it, or set into the ground
  function stoneAt(kind, x, z) {
    const th = THINGS[kind];
    let below = null;
    if (th.stack) for (const o of Object.values(L().things)) {
      const ot = THINGS[o.k];
      if (!ot.stack || Math.hypot(o.x - x, o.z - z) > Math.max(ot.dims.w, ot.dims.d) * 0.55) continue;
      if (!below || o.y + ot.dims.h > below.y + THINGS[below.k].dims.h) below = o;
    }
    return below ? { y: stoneY(below) + THINGS[below.k].dims.h, x: below.x, z: below.z, yaw: below.yaw, below } : { y: surfaceAt(x, z) - th.sink, x, z, yaw: null, below: null };
  }

  /* ================= the gestures ================= */
  const act = { kind: '', n: 0, lx: 0, lz: 0, acc: 0, skim: false, tossed: false, why: '', grab: null, last: null };
  const skimmed = new Set();
  let say = () => {}, shovelSay = null;
  const sayS = (m, secs) => (shovelSay || say)(m, secs);
  const loaded = () => L().carry.m3 > 1e-6;
  // the sea, or a stream deep enough to matter. The live stream simulation answers for every point in its window,
  // dry ground included (depth 0), and rain leaves a film of puddle: neither stops a shovel.
  const isWater = (x, z) => { if (G.heightAt(x, z) < (G.sea ?? -0.2) + 0.05) return true; const w = G.streamWaterAt && G.streamWaterAt(x, z); return !!w && w.depth > 0.05; };
  const litres = (m3) => Math.round(m3 * 1000);
  const matHex = (s) => MAT_HEX[s] ?? 0x5e4632;
  const ptOf = (x, z) => [Math.round(x / STEP), Math.round(z / STEP)];
  function setHeap() {
    const b = L().barrow, bh = ITEM.barrow && ITEM.barrow.heap;
    if (bh) { bh.visible = b.m3 > 1e-6; if (bh.visible) { bh.material.color.setHex(matHex(b.s)); const f = Math.min(1, b.m3 / RD.BARROW_M3); bh.scale.set(0.6 + 0.5 * f, 0.15 + 0.5 * f, 0.8 + 0.5 * f); } }
    const c = L().carry, it = ITEM.shovel;
    it.heap.visible = c.m3 > 1e-6;
    if (it.heap.visible) { it.heap.material.color.setHex(matHex(c.s)); it.heap.scale.set(1, 0.4 + 0.25 * Math.min(2, c.m3 / SCOOP_M3 / 2), 1); }
  }
  // The shovel, shared with the garden. The mouse is your hand on the shovel:
  //  press where the blade goes in (it bites: a jolt and crumbs) and it levers up a scoop;
  //  keep holding and drag: the earth rides on the blade under your hand, and the character walks along if you pull
  //  past arm's reach; let go and it drops there (thrown, if it is a step or two away).
  //  A click without dragging drops it just beside the hole. Press a bag and the blade rips it open.
  /* ---- grains: the flowing layer. Earth that is thrown, spilt or shed off a slope is a shower of grains (clods,
     chips, pebbles) that fall, bounce, roll down the slope with the material's friction and come to rest; each grain
     goes back into the ground where it stops (after Zhu and Bridson's two-layer sand). A slope still steeper than
     loose earth stands sheds more grains, so heaps slump and spread grain by grain, visibly. ---- */
  const GN = 900;
  const grainGeo = new T.IcosahedronGeometry(1, 0);
  { const p = grainGeo.attributes.position.array;          // lumpy, not a perfect solid
    for (let i = 0; i < p.length; i += 3) { const k = 0.78 + 0.44 * hash(Math.round(p[i] * 40) + 7, Math.round(p[i + 1] * 40) * 3 + Math.round(p[i + 2] * 40) * 11); p[i] *= k; p[i + 1] *= k; p[i + 2] *= k; }
    grainGeo.computeVertexNormals(); }
  const grainMesh = new T.InstancedMesh(grainGeo, new T.MeshLambertMaterial(), GN);
  grainMesh.count = 0; grainMesh.castShadow = true; grainMesh.receiveShadow = true; grainMesh.frustumCulled = false;
  grainMesh.setColorAt(0, new T.Color()); G.scene.add(grainMesh);
  const SOIL_COLS = [0x3b2a1e, 0x4a3425, 0x56402d, 0x634a34, 0x2f2218, 0x6e543b];
  // per material: friction (about the tangent of its angle of repose), bounciness, colours, shape
  const GRAIN = {
    soil: { mu: 0.72, e: 0.12, cols: SOIL_COLS, shape: [1, 0.8, 1] },
    bedmix: { mu: 0.7, e: 0.1, cols: [0x2f2219, 0x3b2a1e, 0x45311f], shape: [1, 0.8, 1] },
    woodchips: { mu: 0.78, e: 0.08, cols: [0xc19a66, 0xa47a4c, 0x8a6238, 0xd8b588], shape: [1.7, 0.35, 0.9] },
    bark: { mu: 0.78, e: 0.08, cols: [0x6a412c, 0x8a5a3a, 0x4e2e1f], shape: [1.6, 0.4, 1] },
    sand: { mu: 0.65, e: 0.05, cols: [0xd8c79a, 0xc9b88a, 0xe2d4ac], shape: [1, 0.9, 1] },
  };
  const grainKind = (m) => GRAIN[m] || (DETAIL[m] ? (GRAIN[m] = { mu: 0.62, e: 0.3, cols: DETAIL[m].cols, shape: [1, 0.7, 0.9] }) : GRAIN.soil);
  const grains = [];
  const _gq = new T.Quaternion(), _ga = new T.Vector3(), _gm = new T.Matrix4(), _gs = new T.Vector3(), _gp = new T.Vector3(), _gc = new T.Color();
  // one grain of m3 of material m at (x, y, z) moving (vx, vy, vz); `ground`: already rolling on the surface
  function spawnGrain(x, y, z, vx, vy, vz, m3, m, { delay = 0, ground = false, turf = false, cosmetic = false } = {}) {
    if (grains.length >= GN) return false;
    const K = grainKind(m), r = clamp(Math.cbrt((3 * m3) / (4 * Math.PI)), 0.012, 0.06), q = new T.Quaternion().setFromEuler(E3.set(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    const col = turf && Math.random() < 0.18 ? 0x51702e : K.cols[Math.floor(Math.random() * K.cols.length)];
    grains.push({ x, y, z, vx, vy, vz, r, m3, m, K, q, col, ground, still: 0, age: 0, delay, fade: -1, hops: 0, cosmetic });
    return true;
  }
  const grainBatch = [];
  let groundMoved = false;
  const slides = new Map();   // places where loose ground may still be too steep: key -> { x, z, quiet }
  function grainStep(h) {
    const g9 = 9.8, e = 0.05;
    for (let k = grains.length - 1; k >= 0; k--) {
      const g = grains[k];
      if (g.delay > 0) { g.delay -= h; continue; }
      if (g.fade >= 0) { g.fade += h; if (g.fade > 0.25) grains.splice(k, 1); continue; }
      g.age += h;
      if (!g.ground) {
        g.vy -= g9 * h; g.x += g.vx * h; g.y += g.vy * h; g.z += g.vz * h;
        const gy = surfaceAt(g.x, g.z);
        if (g.y - g.r * 0.7 <= gy) {
          // it hits the ground: bounce off the slope if it came in hard, else start rolling
          const gx = (surfaceAt(g.x + e, g.z) - surfaceAt(g.x - e, g.z)) / (2 * e), gz = (surfaceAt(g.x, g.z + e) - surfaceAt(g.x, g.z - e)) / (2 * e), nl = Math.hypot(gx, 1, gz);
          const nx = -gx / nl, ny = 1 / nl, nz = -gz / nl, vn = g.vx * nx + g.vy * ny + g.vz * nz;
          g.y = gy + g.r * 0.7;
          if (vn < -1.2 && g.hops < 2) { const j = (1 + g.K.e) * vn; g.vx -= j * nx; g.vy -= j * ny; g.vz -= j * nz; g.vx *= 0.7; g.vz *= 0.7; g.hops++; }
          else { g.ground = true; g.vx *= 0.55; g.vz *= 0.55; g.vy = 0; }
        }
      } else {
        // rolling: gravity down the slope, friction against it (Coulomb: stops where the slope is under its repose)
        const gx = (surfaceAt(g.x + e, g.z) - surfaceAt(g.x - e, g.z)) / (2 * e), gz = (surfaceAt(g.x, g.z + e) - surfaceAt(g.x, g.z - e)) / (2 * e);
        const sl = Math.hypot(gx, gz), n2 = 1 + sl * sl;
        g.vx -= (g9 * gx / n2) * h; g.vz -= (g9 * gz / n2) * h;
        const sp = Math.hypot(g.vx, g.vz), fr = (g.K.mu * g9 / Math.sqrt(n2)) * h;
        if (sp <= fr) { g.vx = g.vz = 0; } else { g.vx -= (g.vx / sp) * fr; g.vz -= (g.vz / sp) * fr; }
        const y0 = g.y;
        g.x += g.vx * h; g.z += g.vz * h;
        const gy = surfaceAt(g.x, g.z) + g.r * 0.7;
        // off a lip (the ground falls away faster than it rolls): it drops
        if (y0 - gy > 0.06) { g.ground = false; g.y = y0; g.vy = 0; }
        else g.y = gy;
        if (sp < 0.04) g.still += h; else g.still = 0;   // friction holds it: it has come to rest
        if (g.still > 0.06 || g.age > 4) { g.fade = 0; if (!g.cosmetic) grainBatch.push([+g.x.toFixed(3), +g.z.toFixed(3), g.m3, g.m]); }
      }
      // tumbling: rolls about the axis across its motion
      const sp = Math.hypot(g.vx, g.vz);
      if (sp > 1e-3) { _ga.set(g.vz / sp, 0, -g.vx / sp); g.q.premultiply(_gq.setFromAxisAngle(_ga, (sp * h) / g.r)); }
    }
  }
  function grainTick(dt) {
    if (!grains.length && !slides.size && !grainBatch.length) return;
    const n = Math.max(1, Math.ceil(dt / (1 / 90)));
    for (let i = 0; i < n; i++) grainStep(dt / n);
    // grains at rest go back into the ground, and the ground round them may now be too steep
    if (grainBatch.length) {
      const pts = grainBatch.splice(0, grainBatch.length);
      cmd('landscape.land', { pts });
      groundMoved = true;
      for (const [x, z] of pts) { const key = Math.round(x * 2) + ',' + Math.round(z * 2); if (!slides.has(key)) slides.set(key, { x: Math.round(x * 2) / 2, z: Math.round(z * 2) / 2, quiet: 0 }); }
    }
    // the slopes shed: too steep, the surface comes away and rolls down
    for (const [key, sl] of slides) {
      if (grains.length > GN - 60) break;
      const res = cmd('landscape.shed', { x: sl.x, z: sl.z, r: 0.6 });
      sl.age = (sl.age || 0) + dt;
      if (sl.age > 4) { cmd('landscape.settle', { x: sl.x, z: sl.z, r: 0.7 }); groundMoved = true; slides.delete(key); continue; }   // long enough: let it finish
      if (!res.ok || !res.pts.length) { sl.quiet += dt; if (sl.quiet > 0.4) slides.delete(key); continue; }
      sl.quiet = 0; groundMoved = true;
      // shed earth comes away in crumbs of a few hundred millilitres (neighbouring points together), never lost:
      // a crumb with no room left in the pool goes straight back down where it was
      const acc = new Map();
      for (const [x, z, m3, m, dx, dz] of res.pts) {
        const key = m + ':' + Math.round(x * 5) + ',' + Math.round(z * 5);
        const a = acc.get(key) || { x: 0, z: 0, m3: 0, m, dx: 0, dz: 0 };
        a.x += x * m3; a.z += z * m3; a.dx += dx * m3; a.dz += dz * m3; a.m3 += m3; acc.set(key, a);
      }
      for (const a of acc.values()) {
        const x = a.x / a.m3, z = a.z / a.m3, dl = Math.hypot(a.dx, a.dz) || 1;
        if (!spawnGrain(x, surfaceAt(x, z) + 0.02, z, (a.dx / dl) * 0.45, 0, (a.dz / dl) * 0.45, a.m3, a.m, { ground: true })) grainBatch.push([+x.toFixed(3), +z.toFixed(3), a.m3, a.m]);
      }
    }
    // draw
    let c = 0;
    for (const g of grains) {
      const k = g.fade >= 0 ? Math.max(0, 1 - g.fade / 0.25) : 1, sh = g.K.shape;
      _gm.compose(_gp.set(g.x, g.y - (g.fade >= 0 ? g.r * 0.3 * (1 - k) : 0), g.z), g.q, _gs.set(g.r * sh[0] * k, g.r * sh[1] * k, g.r * sh[2] * k));
      grainMesh.setMatrixAt(c, _gm); grainMesh.setColorAt(c, _gc.setHex(g.col)); c++;
    }
    grainMesh.count = c; grainMesh.instanceMatrix.needsUpdate = true; if (grainMesh.instanceColor) grainMesh.instanceColor.needsUpdate = true;
  }
  const grainsBusy = () => grains.length > 0;
  const _bw = new T.Vector3();
  function bladePos() { ITEM.shovel.obj.updateWorldMatrix(true, false); return _bw.set(0, 0.16, 0.06).applyMatrix4(ITEM.shovel.obj.matrixWorld); }
  const THROW = 3.5;                       // about as far as a shovelful carries
  const REACH = 1.15;                      // how far from you the blade can be held out
  const dig = { ph: '', t: 0, x: 0, z: 0, tx: 0, tz: 0, held: false, bag: null, fail: false, done: false, levered: false, bit: false };
  function bagAt(x, z) { let best = null, bd = 0.38; for (const o of Object.values(L().things)) if (o.k === 'bag') { const d = Math.hypot(o.x - x, o.z - z); if (d < bd) { best = o; bd = d; } } return best; }
  const onBlade = () => loaded();
  // just beside the hole, on the far side from you
  function besideHole(x, z, out) {
    const P = G.player, d = Math.hypot(x - P.x, z - P.z) || 1, ux = (x - P.x) / d, uz = (z - P.z) / d;
    let tx = x, tz = z;
    for (const [fw, sd] of [[0.55, 0.45], [0.55, -0.45], [-0.1, 0.8], [-0.1, -0.8]]) { tx = x + ux * fw + uz * sd; tz = z + uz * fw - ux * sd; if (!isWater(tx, tz)) break; }
    out[0] = tx; out[1] = tz; return out;
  }
  // where the load goes: the ground under the pointer (not clamped to the arms), no further than a throw
  function dropSpot(out) {
    const a = H.aim, P = G.player;
    let tx = a.gx ?? a.x, tz = a.gz ?? a.z;
    if (dig.ph && Math.hypot(tx - dig.x, tz - dig.z) < 0.35) return besideHole(dig.x, dig.z, out);
    const d = Math.hypot(tx - P.x, tz - P.z);
    if (d > THROW) { tx = P.x + ((tx - P.x) * THROW) / d; tz = P.z + ((tz - P.z) * THROW) / d; }
    out[0] = tx; out[1] = tz; return out;
  }
  const _ts = [0, 0];
  function bite() {
    const x = dig.x, z = dig.z, y = surfaceAt(x, z);
    if (dig.bag) {
      const o = L().things[dig.bag];
      const res = o ? cmd('landscape.open', { id: o.id, spill: true }) : { ok: false, reason: 'The bag is gone.' };
      if (!res.ok) { dig.fail = true; return sayS(res.reason); }
      // the bag splits and what was in it pours out and slides into a heap
      const n = clamp(Math.round(res.m3 / 0.0008), 24, 80);
      for (let k = 0; k < n; k++) { const a = Math.random() * 6.283, v = 0.1 + Math.random() * 0.45, rr = Math.random() * 0.18; if (!spawnGrain(x + Math.cos(a) * rr, y + 0.1 + Math.random() * 0.12, z + Math.sin(a) * rr, Math.cos(a) * v, 0.2 + Math.random() * 0.5, Math.sin(a) * v, res.m3 / n, res.m, { delay: Math.random() * 0.15 })) grainBatch.push([+x.toFixed(3), +z.toFixed(3), res.m3 / n, res.m]); }
      G.burst(x, y + 0.2, z, 8, 0xd8d0b8, 1.8, 2.2, 0.08, 0.7);         // shreds of the bag G.juice.hitStop = 0.09;
      dirty = true;
      return sayS('Ripped the bag open: ' + Math.round(res.m3 * 1000) + ' L of ' + (res.m === 'bedmix' ? 'bed soil' : (SURFACES[res.m] ? SURFACES[res.m].name.toLowerCase() : res.m)) + '. Press on the heap and drag a scoop to where it goes.', 5);
    }
    if (isWater(x, z)) { dig.fail = true; return sayS('That is water.'); }
    // the blade bites: a jolt, a stop, crumbs kicked up G.juice.hitStop = 0.015 + 0.06 * HARD;
    const turf = !EW.sAt(grid(), Math.round(x / STEP), Math.round(z / STEP));
    G.burst(x, y + 0.05, z, 3 + Math.round(7 * HARD), turf ? 0x5e8a3a : 0x4c3726, 1.0, 1.6, 0.045, 0.45);
  }
  // a bite of earth onto the blade: the first one with the stamp (`m3`), then more as it is pushed further in (`add`)
  function lever(m3, add) {
    const x = dig.x, z = dig.z;
    const res = cmd('landscape.dig', { x, z, m3, add });
    if (!res.ok) { if (!add) { dig.fail = true; sayS(res.reason); } return null; }
    dig.load = res.load; dig.cap = res.cap;
    if (add) {
      // the blade goes deeper: earth crumbles in from the rim of the hole
      const y = surfaceAt(x, z);
      for (let q = 0; q < 3; q++) { const a = Math.random() * 6.283, r = 0.3 + Math.random() * 0.08; spawnGrain(x + Math.cos(a) * r, y + 0.1, z + Math.sin(a) * r, -Math.cos(a) * 0.5, 0.2, -Math.sin(a) * 0.5, 0.0003, res.s, { cosmetic: true }); }
      G.burst(x, y + 0.04, z, 2, res.s === 'soil' ? 0x4c3726 : matHex(res.s), 0.8, 1.0, 0.04, 0.35);
      setHeap();
      return res;
    }
    const y = surfaceAt(x, z);
    G.burst(x, y + 0.12, z, 12, res.s === 'soil' ? 0x5a4230 : matHex(res.s), 1.6, 2.8, 0.07, 0.6);
    if (res.turf) G.burst(x, y + 0.12, z, 6, 0x5e8a3a, 1.6, 2.6, 0.07, 0.7);
    if (res.liner) sayS('You cut into the pond liner: the water ran out. The liner is back in your stock.', 5);
    lastTurf = !!res.turf;
    { const key = Math.round(x * 2) + ',' + Math.round(z * 2); slides.set(key, { x, z, quiet: 0 }); }   // dug at the foot of a heap: it may slide in
    setHeap(); tip(res.s === 'soil' ? 'dug' : 'scooped', res);
    return res;
  }
  let lastTurf = false;
  // the load leaves the blade as a stream of grains aimed at (tx, tz): tipped off close by, thrown in an arc further
  function throwLoad(tx, tz) {
    if (!loaded()) return;
    const c = L().carry, m3 = c.m3, m = c.s, from = bladePos().clone();
    const res = cmd('landscape.pour', { x: tx, z: tz });
    if (!res.ok) return;
    ITEM.shovel.heap.visible = false;
    const n = clamp(Math.round(m3 / 0.0006), 10, 60), per = m3 / n, d = Math.hypot(tx - from.x, tz - from.z), ty = surfaceAt(tx, tz);
    const TT = d < 0.8 ? 0.22 : 0.28 + d * 0.07;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.283, rr = (0.06 + d * 0.05) * Math.sqrt(Math.random()), x1 = tx + Math.cos(a) * rr, z1 = tz + Math.sin(a) * rr;
      const x0 = from.x + (Math.random() - 0.5) * 0.08, y0 = from.y + Math.random() * 0.05, z0 = from.z + (Math.random() - 0.5) * 0.08, T2 = TT * (0.9 + 0.2 * Math.random());
      if (!spawnGrain(x0, y0, z0, (x1 - x0) / T2, (ty + 0.04 - y0) / T2 + 0.5 * 9.8 * T2, (z1 - z0) / T2, per, m, { delay: (k / n) * 0.12, turf: lastTurf && m === 'soil' })) grainBatch.push([+x1.toFixed(3), +z1.toFixed(3), per, m]);
    }
    tip('tossed', { s: m });
  }
  // the timeline of one scoop: in (0-0.12 s), bite, lever up (to 0.28 s), then carried while held, then tipped off
  // How hard the ground is decides the stroke, as with a real spade: loose earth or chips take the blade at a push;
  // firm ground wants a stamp; turf, matted with roots, a hard stamp and a jolt. Lifting is slower when it is heavy.
  const T_TIP = 0.24;
  let T_BITE = 0.12, HARD = 0.5;
  function hardness(x, z) {
    const g = grid(), i = Math.round(x / STEP), j = Math.round(z / STEP), sc = EW.sAt(g, i, j), f = EW.fAt(g, i, j), l = EW.lAt(g, i, j);
    if (sc === 0) return 1;                                           // turf
    if (l > 0.002 || (f & EW.LOOSE_BIT)) return 0.15;                // loose: thrown earth, chips, gravel
    if (f & (RD.FLAG.TAMP1 | RD.FLAG.TAMP2)) return 0.85;              // packed
    return 0.5 + clamp(-EW.hAt(g, i, j) * 0.5, 0, 0.3);               // firm, harder deeper down (subsoil, clay)
  }
  // The scoop: the blade is stamped in (it bites and takes about half a blade), then sinks further while you hold
  // the button still, taking more as it goes (faster in loose earth, slowly through turf and clay), until the blade
  // is full. Drag and it levers up and comes with you; let go and it levers up and drops beside the hole.
  const T_LIFT = 0.16;
  function digTick(dt) {
    const P = G.player;
    if (!dig.ph) { if (!push.on) P.lead = null; return; }
    const sp = G.juice && G.juice.hitStop > 0 ? 0.12 : 1;
    dig.t += dt * sp;
    const a = H.aim, moved = Math.hypot((a.gx ?? a.x) - dig.x, (a.gz ?? a.z) - dig.z) > 0.18;
    if (dig.ph === 'in') {
      if (!dig.bit && dig.t >= T_BITE) {
        dig.bit = true; bite();
        if (dig.bag || dig.fail) { dig.ph = 'lift'; dig.t = 0; return; }
        if (!lever(SCOOP_M3 * (L().scale || 1) * 0.5, false)) { dig.ph = 'lift'; dig.t = 0; return; }
        dig.ph = 'sink'; dig.t = 0; dig.next = 0;
      }
      return;
    }
    if (dig.ph === 'sink') {
      // still held and not dragged: the blade goes on in
      if (dig.held && !moved) {
        dig.next -= dt;
        if (dig.next <= 0 && dig.load < dig.cap - 1e-6) {
          dig.next = 0.07;
          const rate = dig.cap / (0.35 + 0.65 * HARD);                // a full blade in 0.45 s (loose) to 1 s (turf)
          if (!lever(rate * 0.07, true)) dig.load = dig.cap;           // something else under the blade: that is all
        }
        return;
      }
      dig.ph = 'lift'; dig.t = 0;
      if (!dig.held && dig.let == null && moved) dig.let = dropSpot([0, 0]);
      return;
    }
    if (dig.ph === 'lift') {
      if (dig.t < T_LIFT) return;
      if (!loaded()) { dig.ph = ''; return; }
      if (dig.held) { dig.ph = 'carry'; return; }
      besideHole(dig.x, dig.z, _ts);
      if (dig.let) { dig.tx = dig.let[0]; dig.tz = dig.let[1]; } else { dig.tx = _ts[0]; dig.tz = _ts[1]; }
      dig.ph = 'tip'; dig.t = 0; dig.done = false;
      return;
    }
    if (dig.ph === 'carry') {
      if (!loaded()) { dig.ph = ''; return; }
      dropSpot(_ts); dig.tx = _ts[0]; dig.tz = _ts[1];
      // pulled past arm's reach: the character walks after your hand
      const gx = a.gx ?? a.x, gz = a.gz ?? a.z, d = Math.hypot(gx - P.x, gz - P.z);
      P.lead = d > 1.9 ? { x: ((gx - P.x) / d) * Math.min(1, (d - 1.9) / 0.8), z: ((gz - P.z) / d) * Math.min(1, (d - 1.9) / 0.8) } : null;
      return;
    }
    if (dig.ph === 'tip') {
      P.lead = null;
      if (!dig.done && dig.t >= 0.07) { dig.done = true; throwLoad(dig.tx, dig.tz); }
      if (dig.t >= T_TIP) dig.ph = '';
    }
  }
  // the pose: blade and hands, the handle between them
  const _D = { x: 0, y: 0, z: 0 }, _T = { x: 0, y: 0, z: 0 }, _B = new T.Vector3(), _Hn = new T.Vector3(), _dir = new T.Vector3(), _UP = new T.Vector3(0, 1, 0);
  const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
  // a point held out toward (lx, lz) in the character's frame, no further than the arms and handle reach
  function within(p, lo = 0.55) {
    const d = Math.hypot(p.x, p.z);
    if (d > REACH) { p.x *= REACH / d; p.z *= REACH / d; }
    else if (d < lo) { if (d < 1e-3) { p.x = 0; p.z = lo; } else { p.x *= lo / d; p.z *= lo / d; } }
    return p;
  }
  let bob = 0;
  ITEM.shovel.anim = (o, pm, toLocal, dt) => {
    if (patA.on) {
      // raised and brought down flat: a slap with the back of the blade
      const P = G.player, k = patA.t < 0.11 ? ease(patA.t / 0.11) : 1 - ease((patA.t - 0.11) / 0.19);
      within(toLocal(patA.x, surfaceAt(patA.x, patA.z), patA.z, _D));
      o.position.set(_D.x, _D.y + 0.04 + 0.32 * (patA.t < 0.11 ? 1 - k : 1 - k), _D.z);
      _Hn.set(0.05, 1.0 + 0.25 * (1 - k), 0.22);
      o.quaternion.setFromUnitVectors(_UP, _dir.subVectors(_Hn, o.position).normalize());
      pm.armL.rotation.x = pm.armR.rotation.x = -0.8 - 0.6 * (1 - k); pm.body.rotation.x += 0.25 * k;
      P.faceHold = Math.atan2(patA.x - P.x, patA.z - P.z);
      return true;
    }
    if (push.on) {
      // the blade flat on the ground in front, handle low, leaning into it
      const P = G.player;
      within(toLocal(push.x, surfaceAt(push.x, push.z), push.z, _D));
      o.position.set(_D.x, _D.y + 0.04, _D.z);
      _Hn.set(0.05, 0.92, 0.22);
      o.quaternion.setFromUnitVectors(_UP, _dir.subVectors(_Hn, o.position).normalize());
      pm.armL.rotation.x = pm.armR.rotation.x = -0.75; pm.body.rotation.x += 0.32;
      P.faceHold = Math.atan2(push.x - P.x, push.z - P.z);
      return true;
    }
    if (!dig.ph) return false;
    const P = G.player, t = dig.t;
    let arm, lean = 0, leg = 0, face;
    if (dig.ph === 'in' || dig.ph === 'sink' || dig.ph === 'lift') {
      within(toLocal(dig.x, surfaceAt(dig.x, dig.z), dig.z, _D));
      // stamped in from above; pushed on in while held (deeper as it fills, rocking a little); levered up and back
      const full = dig.cap ? clamp(dig.load / dig.cap, 0, 1) : 0;
      const kIn = dig.ph === 'in' ? ease(t / T_BITE) : 1, kUp = dig.ph === 'lift' ? ease(t / T_LIFT) : 0;
      const sink = dig.ph === 'in' ? 0 : 0.12 * full * (1 - kUp), rock = dig.ph === 'sink' ? 0.03 * Math.sin(dig.t * 22) : 0;
      const back = 0.18 * kUp, d = Math.hypot(_D.x, _D.z) || 1;
      _B.set(_D.x - (_D.x / d) * back, _D.y + 0.38 - 0.54 * kIn - sink + 0.62 * kUp, _D.z - (_D.z / d) * back);
      _Hn.set(0.05 + rock, 1.38 - 0.36 * kIn - 0.1 * full * (1 - kUp) - 0.02 * kUp, 0.18 + 0.16 * kIn - 0.2 * kUp);
      arm = -1.7 + 0.7 * kIn + 0.15 * kUp; lean = 0.32 * kIn + 0.08 * full * (1 - kUp) - 0.2 * kUp;
      leg = dig.ph === 'in' ? -0.55 * Math.sin(Math.PI * Math.min(1, t / T_BITE)) : dig.ph === 'sink' ? -0.35 * (1 - full) : 0;   // a boot on the blade
      face = Math.atan2(dig.x - P.x, dig.z - P.z);
    } else {
      // carried: the blade, loaded, held out over where it will drop; tipped: a flick up and over
      within(toLocal(dig.tx, surfaceAt(dig.tx, dig.tz), dig.tz, _D));
      bob += dt * 7;
      const kT = dig.ph === 'tip' ? Math.sin(Math.PI * Math.min(1, t / T_TIP)) : 0;
      _B.set(_D.x, _D.y + 0.42 + 0.03 * Math.sin(bob) + 0.22 * kT, _D.z);
      _Hn.set(0.05, 1.02 + 0.2 * kT, 0.2 - 0.05 * kT);
      arm = -0.9 - 0.5 * kT; lean = 0.08 - 0.1 * kT;
      face = Math.atan2(dig.tx - P.x, dig.tz - P.z);
    }
    o.position.copy(_B);
    o.quaternion.setFromUnitVectors(_UP, _dir.subVectors(_Hn, _B).normalize());
    pm.armL.rotation.x = pm.armR.rotation.x = arm;
    pm.body.rotation.x += lean;
    if (pm.legR) pm.legR.rotation.x = leg;
    P.faceHold = face;
    return true;
  };
  // The flat of the blade (right button): drag it along the ground and loose earth in its way is pushed ahead of it,
  // hollows it passes are filled from what it pushes, and what is left is dropped where you let go. The blade can only
  // go down as you push: it starts a few centimetres into the ground where you press and follows the ground down, so
  // pushed across a heap from beside it, it bulldozes the heap flat; dragged off the top of a heap, it spreads it out.
  const BITE = 0.04;
  const push = { on: false, x: 0, z: 0, level: 0, load: 0, s: 'soil', moved: 0, crumb: 0 };
  function pushPress(a) {
    if (isWater(a.x, a.z)) return sayS('That is water.');
    Object.assign(push, { on: true, x: a.x, z: a.z, level: relief(a.x, a.z) - BITE, load: 0, moved: 0, crumb: 0, t0: performance.now() });
    G.juice.hitStop = 0.02;
  }
  function pushFrame(a, dt) {
    if (!push.on) return;
    const P = G.player, gx = a.gx ?? a.x, gz = a.gz ?? a.z, dp = Math.hypot(gx - P.x, gz - P.z);
    P.lead = dp > 1.9 ? { x: ((gx - P.x) / dp) * Math.min(1, (dp - 1.9) / 0.8), z: ((gz - P.z) / dp) * Math.min(1, (dp - 1.9) / 0.8) } : null;
    let tx = a.x, tz = a.z, L = Math.hypot(tx - push.x, tz - push.z);
    if (L < 0.04) return;
    // in short steps, so the blade follows the ground and nothing is skipped
    const n = Math.ceil(L / 0.1);
    for (let k = 1; k <= n; k++) {
      const x1 = push.x + ((tx - push.x) * 1) / (n - k + 1), z1 = push.z + ((tz - push.z) * 1) / (n - k + 1);
      if (isWater(x1, z1)) break;
      push.level = Math.min(push.level, relief(x1, z1) - BITE);
      const res = cmd('landscape.push', { x0: push.x, z0: push.z, x1, z1, level: push.level });
      if (!res.ok) { if (act.why !== res.reason) sayS(res.reason); act.why = res.reason; break; }
      push.moved += Math.hypot(x1 - push.x, z1 - push.z); push.x = x1; push.z = z1;
      push.load = res.m3; push.s = res.s || push.s;
      groundMoved = true;
      // earth rolling off the front of the blade
      if (res.m3 > 0.002 && push.moved - push.crumb > 0.12) {
        push.crumb = push.moved;
        const ux = (tx - push.x) || 1e-3, uz = (tz - push.z), ul = Math.hypot(ux, uz) || 1, y = surfaceAt(x1, z1);
        for (let q = 0; q < 2 + Math.min(4, Math.round(res.m3 * 200)); q++) spawnGrain(x1 + (ux / ul) * 0.12 + (Math.random() - 0.5) * 0.35, y + 0.08, z1 + (uz / ul) * 0.12 + (Math.random() - 0.5) * 0.35, (ux / ul) * 0.4, 0.3, (uz / ul) * 0.4, 0.0004, push.s, { cosmetic: true });
      }
    }
  }
  function pushRelease() {
    if (!push.on) return;
    push.on = false; G.player.lead = null;
    // a right-click without a drag: the back of the blade patted down on the spot
    if (push.moved < 0.02 && performance.now() - push.t0 < 450) { patA.on = true; patA.t = 0; patA.x = push.x; patA.z = push.z; patA.done = false; return; }
    // the blade lifts: the ridge it was holding slumps back, and then settles grain by grain
    if (push.moved > 0) cmd('landscape.settle', { x: push.x, z: push.z, r: 0.9 });
    const key = Math.round(push.x * 2) + ',' + Math.round(push.z * 2); slides.set(key, { x: push.x, z: push.z, quiet: 0 });
    if (push.moved > 0.3) tip('pushed');
  }
  // The back of the blade patted down (a right-click): lumps go, the slope stays, and the earth is firmed.
  const patA = { on: false, t: 0, x: 0, z: 0, done: false };
  function patTick(dt) {
    if (!patA.on) return;
    patA.t += dt;
    if (!patA.done && patA.t >= 0.11) {
      patA.done = true;
      const res = cmd('landscape.pat', { x: patA.x, z: patA.z });
      const y = surfaceAt(patA.x, patA.z);
      if (!res.ok) sayS(res.reason);
      else { G.juice.hitStop = 0.035; G.burst(patA.x, y + 0.03, patA.z, 6, 0x6e543b, 1.4, 0.5, 0.04, 0.35); groundMoved = true; tip('patted'); }
    }
    if (patA.t >= 0.3) patA.on = false;
  }
  const shovel = {
    flying: () => grainsBusy() || !!dig.ph || push.on || patA.on,
    press(a) {
      act.kind = 'shovel';
      if (!owns('shovel') && !owns('spade')) { act.kind = ''; return sayS('You need a shovel.'); }
      if (a.alt) { if (!dig.ph && !patA.on) pushPress(a); return; }
      if (dig.ph === 'tip' && !dig.done) { dig.done = true; throwLoad(dig.tx, dig.tz); }
      const bag = bagAt(a.x, a.z);
      Object.assign(dig, { t: 0, held: true, fail: false, done: false, bit: false, levered: false, let: null, bag: null });
      if (onBlade()) { dig.ph = 'carry'; dig.x = a.x; dig.z = a.z; return; }   // already loaded: carry it
      dig.ph = 'in'; dig.x = bag ? bag.x : a.x; dig.z = bag ? bag.z : a.z; dig.bag = bag ? bag.id : null;
      HARD = bag ? 0.2 : hardness(dig.x, dig.z); T_BITE = 0.07 + 0.11 * HARD; dig.load = 0; dig.cap = SCOOP_M3 * (L().scale || 1);
    },
    frame(a, dt) { if (push.on) pushFrame(a, dt); },
    release() {
      if (act.kind !== 'shovel') return;
      act.kind = '';
      if (push.on) return pushRelease();
      dig.held = false;
      if (dig.ph === 'carry') { dropSpot(_ts); dig.tx = _ts[0]; dig.tz = _ts[1]; dig.ph = 'tip'; dig.t = 0; dig.done = false; }
      else if (dig.ph === 'in' || dig.ph === 'sink' || dig.ph === 'lift') {
        // let go before the scoop was up: it goes where you let go (beside the hole if you did not move)
        const a = H.aim, gx = a.gx ?? a.x, gz = a.gz ?? a.z;
        if (Math.hypot(gx - dig.x, gz - dig.z) >= 0.35) dig.let = dropSpot([0, 0]);
      }
    },
    second() {},
  };
  // where the blade goes in (a small ring under the pointer); while carrying, where the load will land, and its arc
  const markMat = new T.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85, depthWrite: false });
  const markRing = new T.Mesh(new T.RingGeometry(0.2, 0.27, 28), markMat);
  markRing.rotation.x = -Math.PI / 2; markRing.renderOrder = 3; markRing.visible = false; G.scene.add(markRing);
  const DOTS = 9, dotMat = new T.MeshBasicMaterial({ color: 0xfff4d0, transparent: true, opacity: 0.55, depthWrite: false });
  const dots = new T.InstancedMesh(new T.IcosahedronGeometry(0.025, 0), dotMat, DOTS);
  dots.frustumCulled = false; dots.visible = false; dots.renderOrder = 3; G.scene.add(dots);
  const _dm = new T.Matrix4();
  let markT = 0;
  // where a delivery was just set down: a big ring that pulses for a few seconds
  const dropMark = { x: 0, z: 0, until: 0 };
  const dropRing = new T.Mesh(new T.RingGeometry(0.85, 1.0, 40), new T.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.8, depthWrite: false }));
  dropRing.rotation.x = -Math.PI / 2; dropRing.renderOrder = 3; dropRing.visible = false; G.scene.add(dropRing);
  function markTick(dt) {
    const left = dropMark.until - performance.now();
    dropRing.visible = left > 0;
    if (left > 0) { dropRing.position.set(dropMark.x, surfaceAt(dropMark.x, dropMark.z) + 0.04, dropMark.z); dropRing.scale.setScalar(1 + 0.12 * Math.sin(markT * 5)); dropRing.material.opacity = Math.min(0.85, left / 1000); }
    const a = H.aim, out = H.isOpen && H.held === 'shovel' && (owns('shovel') || owns('spade'));
    markT += dt;
    dots.visible = false;
    if (!out || (!a.valid && !dig.ph)) { markRing.visible = false; return; }
    let tx, tz, size, col, op;
    const carrying = dig.ph === 'carry' || dig.ph === 'tip';
    if (carrying) { tx = dig.tx; tz = dig.tz; size = 1.15; col = 0xffe08a; op = 0.9; }
    else if (push.on) { tx = push.x; tz = push.z; size = 1.0; col = 0xd8c8a8; op = 0.6; }
    else if (dig.ph === 'in' || dig.ph === 'sink' || dig.ph === 'lift') { tx = dig.x; tz = dig.z; size = 1.35; col = 0xffffff; op = 0.5; }
    else {
      const bag = bagAt(a.x, a.z);
      if (bag) { tx = bag.x; tz = bag.z; size = 1.5; col = 0xffb35c; op = 0.9; }              // the blade will rip this
      else { tx = a.x; tz = a.z; size = 1.35; col = 0xffffff; op = 0.55; }                   // the blade goes in here (the bite)
    }
    const y = surfaceAt(tx, tz);
    markRing.visible = true; markRing.position.set(tx, y + 0.03, tz);
    markRing.scale.setScalar(size * (1 + 0.07 * Math.sin(markT * 6)));
    markMat.color.setHex(col); markMat.opacity = op;
    // thrown (not just tipped off the blade): the arc it will fly
    if (dig.ph === 'carry') {
      const from = bladePos(), d = Math.hypot(tx - from.x, tz - from.z);
      if (d > 0.8) {
        dots.visible = true;
        const arc = 0.2 + d * 0.16;
        for (let i = 0; i < DOTS; i++) {
          const k = (i + ((markT * 1.5) % 1)) / DOTS;
          _dm.makeTranslation(from.x + (tx - from.x) * k, from.y + (y - from.y) * k + Math.sin(Math.PI * k) * arc, from.z + (tz - from.z) * k);
          dots.setMatrixAt(i, _dm);
        }
        dots.instanceMatrix.needsUpdate = true;
      }
    }
  }
  // the turf cutter: drag the blade flat along the grass and the turf comes off in a strip
  const sod = {
    press(a) {
      if (!owns('shovel') && !owns('spade')) return sayS('You need a shovel.');
      act.kind = 'sod'; act.n = 0; act.lx = a.x; act.lz = a.z; act.why = ''; skimmed.clear();
    },
    frame(a) {
      const len = Math.hypot(a.x - act.lx, a.z - act.lz);
      if (len < 0.06) return;
      const n = Math.max(1, Math.ceil(len / 0.08)), pts = [];
      for (let i = 1; i <= n; i++) { const x = act.lx + ((a.x - act.lx) * i) / n, z = act.lz + ((a.z - act.lz) * i) / n; if (!isWater(x, z)) pts.push([x, z]); }
      act.lx = a.x; act.lz = a.z;
      if (!pts.length) return;
      const res = cmd('landscape.skim', { points: pts });
      if (!res.ok) { if (!act.why) sayS(res.reason); act.why = res.reason; return; }
      if (res.m2 > 0) { act.n += res.m2; G.burst(a.x, surfaceAt(a.x, a.z) + 0.1, a.z, 5, 0x5e8a3a, 1.4, 2.2, 0.07, 0.6); G.burst(a.x, surfaceAt(a.x, a.z) + 0.06, a.z, 3, 0x5a4230, 1.2, 1.6, 0.05, 0.5); }
    },
    release() {
      if (act.n) { sayS('Cut ' + act.n.toFixed(1) + ' m² of turf off. Bare earth takes gravel, chips, sand, fabric or lawn seed.'); tip('skim'); }
      act.kind = '';
    },
  };
  // the rake: drag over loose ground and it evens out
  function rakeFrame(a) {
    if (Math.hypot(a.x - act.lx, a.z - act.lz) < 0.1) return;
    act.lx = a.x; act.lz = a.z;
    const res = cmd('landscape.rake', { x: a.x, z: a.z, r: 0.4, k: 0.6 });
    if (!res.ok) { if (!act.why) say(res.reason); act.why = res.reason; return; }
    if (res.m3 > 0.0002) { act.n++; G.burst(a.x, surfaceAt(a.x, a.z) + 0.05, a.z, 3, 0x6b4f35, 0.9, 0.9, 0.04, 0.35); }
  }
  // laying a layer from the bucket: hold and sweep; seed: the same, scattered
  function pourFrame(a, dt, k) {
    act.acc += dt;
    if (act.acc < 0.16) return;
    const step = Math.min(0.4, act.acc); act.acc = 0;
    const res = k === 'seed' ? cmd('landscape.seedLawn', { x: a.x, z: a.z, r: 0.42 }) : cmd('landscape.spread', { surface: k, x: a.x, z: a.z, r: 0.42, m3: (k === 'bedmix' ? 0.12 : 0.035) * step * Math.max(0.25, a.tip) });
    if (!res.ok) { if (act.why !== res.reason) say(res.reason, 4); act.why = res.reason; return; }
    act.n++;
    const hex = k === 'seed' ? 0xe8dca0 : matHex(k);
    G.burst(a.x, a.y + 0.55, a.z, 6, hex, 1.2, 0.3, k === 'seed' ? 0.025 : 0.05, 0.6);
  }
  // setting stones: click sets one; dragging lays a line along the drag at the stone's spacing
  function setStone(kind, x, z, yaw, quiet) {
    const at = stoneAt(kind, x, z);
    const res = cmd('landscape.place', { kind, x: at.below ? at.x : x, z: at.below ? at.z : z, yaw: at.yaw ?? yaw });
    if (!res.ok) { if (act.why !== res.reason && !(quiet && /in the way/.test(res.reason))) say(res.reason); act.why = res.reason; return false; }
    act.n++;
    if (!quiet || act.n % 3 === 0) G.burst(x, at.y + 0.05, z, quiet ? 3 : 6, 0x8f887a, 1.0, 1.2, 0.04, 0.4);
    if (res.stacked) tip('course', res);
    else if (!res.firm && !THINGS[kind].box && !THINGS[kind].glow) tip('loose', res);
    return true;
  }
  function stoneFrame(a, kind) {
    const th = THINGS[kind], d = Math.hypot(a.x - act.lx, a.z - act.lz);
    if (d < th.spacing) return;
    const yaw = Math.atan2(a.x - act.lx, a.z - act.lz) + (th.line === 'tight' ? Math.PI / 2 : 0);
    const n = Math.floor(d / th.spacing), ux = (a.x - act.lx) / d, uz = (a.z - act.lz) / d;
    for (let i = 1; i <= n; i++) {
      const x = act.lx + ux * i * th.spacing, z = act.lz + uz * i * th.spacing;
      // cobbles go down in a band: a row across the drag at every step, staggered like real sett paving
      if (th.band) for (let j = 0; j < th.band; j++) { const o = (j - (th.band - 1) / 2) * th.spacing; setStone(kind, x - uz * o, z + ux * o, yaw, true); }
      else setStone(kind, x, z, th.line === 'step' ? ghostYaw : yaw);
    }
    act.lx += ((a.x - act.lx) * n * th.spacing) / d; act.lz += ((a.z - act.lz) * n * th.spacing) / d;
    ghostYaw = th.line === 'tight' ? yaw : ghostYaw;
  }
  // hands: press on a stone or a plant and lift to pick it up
  function nearestThing(x, z) {
    let best = null, bd = 0.4;
    for (const o of Object.values(L().things)) { const d = Math.hypot(o.x - x, o.z - z); if (d < bd || (best && Math.abs(d - bd) < 0.02 && o.y > best.o.y)) { best = { o, kind: 'thing' }; bd = Math.min(bd, d); } }
    for (const p of Object.values(L().plants)) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { best = { o: p, kind: 'plant' }; bd = d; } }
    if (best && best.kind === 'thing') {
      // the top of a stack comes off first
      let top = best.o;
      for (let again = true; again;) { again = false; for (const o of Object.values(L().things)) if (o.on === top.id) { top = o; again = true; } }
      best.o = top;
    }
    return best;
  }

  /* ================= the stance: slots, hint, store ================= */
  const bar = $('lbar');
  if (!bar) return;
  const hint = bar.querySelector('.ghint'), toolsEl = bar.querySelector('.gtools'), storeEl = bar.querySelector('.gseeds');
  // the bar sits in the bottom lane beside the mode chip; its hint and store stack above it in the prompt and context places (template/ui/30-hotbar.css)
  if (window.__ui) {
    const ctx = document.createElement('div'); ctx.className = 'gctx'; ctx.append(hint, storeEl); bar.insertBefore(ctx, toolsEl);
    for (const el of [toolsEl, hint, storeEl]) el.classList.add('panel');
    bar.classList.remove('panel');
    window.__ui.mount(bar, 'bottom', { order: 2 });
    new ResizeObserver(() => document.body.style.setProperty('--lbar-ctx', ctx.offsetHeight + 'px')).observe(ctx);
  }
  const label = $('glabel');
  const I = (body) => '<svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="var(--ic-outline)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  const ICONS = {
    hands: I('<path d="M12 22v-9a2 2 0 0 1 4 0v6M16 18v-8a2 2 0 0 1 4 0v8M20 18v-7a2 2 0 0 1 4 0v8M24 19v-4a2 2 0 0 1 4 0v9c0 6-3 10-9 10-4 0-6-2-8-5l-4-7c-1-2 1-4 3-2l2 3" fill="var(--ic-skin)" stroke="var(--ic-outline)"/>'),
    shovel: I('<path d="M27 5l-9 17" stroke="var(--ic-wood)" stroke-width="2.6"/><path d="M24 4l6 3" stroke="var(--ic-steel)" stroke-width="3"/><path d="M15 20l7 4-3 9c-1 2-4 2-6 1s-3-3-2-5z" fill="var(--ic-steel)" stroke="var(--ic-outline)"/><path d="M6 34c4-3 9-3 14-1" stroke="var(--ic-soil)" stroke-width="2"/>'),
    sod: I('<path d="M30 6L17 21" stroke="var(--ic-wood)" stroke-width="2.6"/><path d="M13 19l7 5-5 6c-2 1-5 0-6-2z" fill="var(--ic-steel)" stroke="var(--ic-outline)"/><path d="M4 31c8 2 14 2 20-1" stroke="var(--ic-leaf)" stroke-width="3"/><path d="M24 30c3-1 6 0 8 2" stroke="var(--ic-soil)" stroke-width="2"/>'),
    rake: I('<path d="M29 5L15 27" stroke="var(--ic-wood)" stroke-width="2.6"/><path d="M7 25l14 9" stroke="var(--ic-steel)" stroke-width="2.6"/><path d="M8 26l-2 4M11 28l-2 4M14 30l-2 4M17 32l-2 4M20 34l-2 3" stroke="var(--ic-steel)" stroke-width="1.8"/>'),
    bucket: (hex) => I('<path d="M9 15h22l-3 19H12z" fill="var(--ic-leaf)" stroke="var(--ic-outline)"/><path d="M9 15c2-6 20-6 22 0" stroke="var(--ic-outline)"/><ellipse cx="20" cy="15" rx="10" ry="3" fill="' + hex + '" stroke="none"/>'),
    stone: (hex, w, h) => I('<path d="M' + (20 - w) + ' ' + (28) + 'q2-' + h + ' ' + w + '-' + h + 't' + w + ' ' + h + 'z" fill="' + hex + '" stroke="var(--ic-outline)"/><path d="M5 30h30" stroke="var(--ic-soil)" stroke-width="2"/>'),
    wall: I('<path d="M6 32h12v-7H6zM20 32h14v-7H20zM10 25h14v-7H10zM26 25h8v-7h-8z" fill="var(--ic-stone)" stroke="var(--ic-outline)" stroke-width="1.6"/>'),
    pot: (hex) => I('<path d="M13 24h14l-2 11H15z" fill="var(--ic-soil)" stroke="var(--ic-outline)"/><circle cx="20" cy="15" r="8" fill="' + hex + '" stroke="var(--ic-outline)"/><path d="M20 23v-6" stroke="var(--ic-leaf)"/>'),
    barrow: I('<path d="M6 14h20l-4 10H11z" fill="var(--ic-water)" stroke="var(--ic-outline)"/><circle cx="25" cy="29" r="4" fill="var(--ic-steel)" stroke="var(--ic-outline)"/><path d="M8 24l-3 8M21 24l4 2M26 14l9-4" stroke="var(--ic-wood)" stroke-width="2"/>'),
    can: I('<path d="M10 16h16v16H10z" fill="var(--ic-leaf)" stroke="var(--ic-outline)"/><path d="M26 19l9-7" stroke="var(--ic-outline)" stroke-width="3"/><path d="M12 16c0-6 12-6 12 0" stroke="var(--ic-outline)"/>'),
    hose: I('<circle cx="20" cy="20" r="11" stroke="var(--ic-leaf)" stroke-width="3.2"/><circle cx="20" cy="20" r="6" stroke="var(--ic-leaf)" stroke-width="3"/><path d="M31 20h5" stroke="var(--ic-leaf)" stroke-width="3"/>'),
    liner: I('<rect x="8" y="10" width="24" height="8" rx="4" fill="var(--ic-steel)" stroke="var(--ic-outline)"/><path d="M10 18c0 8 20 8 20 0" fill="var(--ic-water)" stroke="var(--ic-outline)"/>'),
    tamper: I('<path d="M20 5v24" stroke="var(--ic-outline)" stroke-width="2.6"/><path d="M15 5h10" stroke="var(--ic-steel)" stroke-width="3"/><path d="M11 29h18v4H11z" fill="var(--ic-steel)" stroke="var(--ic-outline)"/><path d="M6 35h28" stroke="var(--ic-soil)" stroke-width="2" stroke-dasharray="2 2"/>'),
    fabric: I('<rect x="7" y="9" width="26" height="9" rx="4.5" fill="var(--ic-steel)" stroke="var(--ic-outline)"/><path d="M9 18l-2 15h26l-2-15" fill="var(--ic-steel)" stroke="var(--ic-outline)"/><path d="M11 22h18M10 26h20M9 30h22" stroke="var(--ic-steel)" stroke-width="1"/>'),
    gbox: I('<path d="M5 20l15-7 15 7-15 7z" fill="var(--ic-wood)" stroke="var(--ic-outline)"/><path d="M5 20v8l15 7 15-7v-8" fill="var(--ic-wood)" stroke="var(--ic-outline)"/><path d="M20 27v8" stroke="var(--ic-outline)"/>'),
    ashlar: I('<path d="M5 32h14v-7H5zM19 32h16v-7H19zM9 25h16v-7H9zM25 25h10v-7H25zM5 25h4v-7H5z" fill="var(--ic-stone)" stroke="var(--ic-outline)" stroke-width="1.5"/>'),
    cobble: I('<path d="M6 12h8v8H6zM16 12h8v8h-8zM26 12h8v8h-8zM11 22h8v8h-8zM21 22h8v8h-8z" fill="var(--ic-stone)" stroke="var(--ic-outline)" stroke-width="1.4"/>'),
    cap: I('<path d="M5 18h30v5H5z" fill="var(--ic-stone)" stroke="var(--ic-outline)" stroke-width="1.6"/><path d="M8 23h24v10H8z" fill="var(--ic-stone)" stroke="var(--ic-outline)" stroke-width="1.4"/>'),
    curb: I('<path d="M4 20h32v8H4z" fill="var(--ic-stone)" stroke="var(--ic-outline)" stroke-width="1.6"/><path d="M4 28c6-3 26-3 32 0" stroke="var(--ic-leaf)" stroke-width="2"/>'),
    timber: I('<path d="M5 24h30v6H5zM8 18h24v6H8z" fill="var(--ic-wood)" stroke="var(--ic-outline)" stroke-width="1.6"/>'),
    light: I('<path d="M20 16v18" stroke="var(--ic-steel)" stroke-width="2.4"/><path d="M14 12h12l-2 5h-8z" fill="var(--ic-warn)" stroke="var(--ic-outline)"/><circle cx="20" cy="9" r="2" fill="var(--ic-paper)" stroke="none"/>'),
    store: I('<path d="M5 16l3-8h24l3 8z" fill="var(--ic-leaf)" stroke="var(--ic-outline)"/><path d="M7 16v17h26V16" stroke="var(--ic-outline)"/><path d="M16 33v-9h8v9" fill="var(--ic-wood)" stroke="var(--ic-outline)"/>'),
  };
  const PLANT_HEX = { lavender: '#8b6fc4', coneflower: '#e8b52a', grass: '#b7a26a', boxwood: '#3d6a31', hydrangea: '#f1f0e2', rose: '#c4243a', maple: '#9b2226', blueberry: '#4a5a9c', apple: '#c0392b', iris: '#f2d02a' };
  const LAYER_ITEM = { bedmix: 'raised_bed_mix', gravel: 'gravel', crushed: 'crushed_stone', dg: 'decomposed_granite', slate: 'slate_chips', marble: 'marble_chips', lava: 'lava_rock', riverrock: 'river_rock', woodchips: 'wood_chips', bark: 'bark_mulch', sand: 'sand', seed: 'grass_seed' };
  const amount = (k) => { const id = LAYER_ITEM[k], u = ITEMS[id].unit, v = have(id); return u === 'm3' ? Math.round(v * 1000) + ' L' : u === 'kg' ? (v < 1 ? Math.round(v * 1000) + ' g' : v.toFixed(1) + ' kg') : Math.round(v) + ' L'; };
  function slotList() {
    const out = [{ id: 'hands', name: 'Hands', icon: ICONS.hands, title: 'Hands: pick up stones and plants' }];
    out.push({ id: 'shovel', name: 'Shovel', icon: ICONS.shovel, item: ITEM.shovel, dim: !owns('shovel') && !owns('spade'), badge: loaded() ? litres(L().carry.m3) + ' L' : null, title: 'Shovel: press to dig a scoop, drag it where it goes, let go to drop it' });
    out.push({ id: 'sod', name: 'Cut turf', icon: ICONS.sod, item: ITEM.shovel, dim: !owns('shovel') && !owns('spade'), title: 'Cut turf: drag the shovel flat along the grass to strip it off' });
    out.push({ id: 'rake', name: 'Rake', icon: ICONS.rake, item: ITEM.rake, dim: !owns('rake'), title: 'Rake: level loose ground' });
    if (owns('tamper')) out.push({ id: 'tamper', name: 'Tamper', icon: ICONS.tamper, item: ITEM.tamper, title: 'Hand tamper: thump loose ground and the base firm before laying stone' });
    if (have('landscape_fabric') >= 0.05) out.push({ id: 'fabric', name: 'Fabric', icon: ICONS.fabric, item: ITEM.fabric, badge: have('landscape_fabric').toFixed(0) + ' m²', title: 'Landscape fabric: roll it over dug-out ground before gravel, chips or stone' });
    if (have('raised_bed_mix') >= 1) out.push({ id: 'bedmix', name: 'Bed soil', icon: ICONS.bucket('#3f2c1f'), item: ITEM.bedmix, badge: Math.round(have('raised_bed_mix')) + ' L', title: 'Raised-bed soil: pour it into a garden box' });
    if (owns('wheelbarrow')) out.push({ id: 'barrow', name: 'Barrow', icon: ICONS.barrow, item: ITEM.barrow, badge: L().barrow.m3 > 1e-6 ? litres(L().barrow.m3) + ' L' : null, title: 'Wheelbarrow: click to shovel a scoop in, drag down to tip it out' });
    const GV = window.__gardenView;
    if (GV && GV.can && owns('watering_can')) out.push({ id: 'can', name: 'Can', icon: ICONS.can, item: GV.can.item, badge: Math.round((G.sim.state.sys.garden.can.litres || 0) * 10) / 10 + ' L', title: 'Watering can: water new plants in; fill it at the pump or the stream' });
    if (owns('garden_hose')) out.push({ id: 'hose', name: 'Hose', icon: ICONS.hose, item: ITEM.hose, title: 'Hose: click a lined pond to fill it' });
    if (have('pond_liner') >= 0.05) out.push({ id: 'liner', name: 'Liner', icon: ICONS.liner, item: ITEM.liner, badge: have('pond_liner').toFixed(1) + ' m²', title: 'Pond liner: click a dug hole to line it' });
    for (const [k, nm, hex] of [['woodchips', 'Wood chips', '#a47a4c'], ['bark', 'Bark', '#6a412c'], ['gravel', 'Pea gravel', '#a49d90'], ['crushed', 'Crushed', '#8a8a86'], ['dg', 'Granite fines', '#c4a57a'], ['slate', 'Slate', '#4f5a63'], ['marble', 'Marble', '#e6e3dc'], ['lava', 'Lava rock', '#7a3b2c'], ['riverrock', 'River rock', '#8c8478'], ['sand', 'Sand', '#d8c79a'], ['seed', 'Lawn seed', '#d9cf9a']])
      if (have(LAYER_ITEM[k]) > 1e-6) out.push({ id: k, name: nm, icon: ICONS.bucket(hex), item: ITEM[k], badge: amount(k) });
    for (const k of Object.keys(THINGS)) {
      const th = THINGS[k], n = have(th.item) / th.qty;
      if (n >= 1 - 1e-6) out.push({ id: k, name: th.name.replace('Brick ', '').replace('Granite edging', 'Edging'), icon: k === 'wallstone' ? ICONS.wall : k === 'cutstone' ? ICONS.ashlar : k === 'cobble' ? ICONS.cobble : k === 'capstone' ? ICONS.cap : k === 'curb' ? ICONS.curb : k === 'gardenbox' ? ICONS.gbox : k === 'timber' ? ICONS.timber : k === 'pathlight' ? ICONS.light : ICONS.stone(k === 'paver' ? '#a65a3f' : k === 'boulder' ? '#7d7a72' : '#b9a988', k === 'boulder' ? 12 : 10, k === 'boulder' ? 14 : k === 'flagstone' ? 3 : 5), item: ITEM[k], badge: Math.floor(n + 1e-6) });
    }
    for (const k of Object.keys(PLANTS)) if (have(PLANTS[k].item) >= 1) out.push({ id: 'plant:' + k, name: PLANTS[k].name.split(' ').pop(), icon: ICONS.pot(PLANT_HEX[k]), item: ITEM['plant:' + k], badge: Math.floor(have(PLANTS[k].item)), title: PLANTS[k].name });
    out.push({ id: 'store', name: 'Yard store', icon: ICONS.store, title: 'Buy gravel, stones, seed and plants' });
    return out;
  }
  const held = () => H.held || 'hands';
  const flash = { msg: '', until: 0 };
  say = (msg, secs = 3) => { flash.msg = msg; flash.until = performance.now() + secs * 1000; updateHint(true); };
  function buy(id, qty) {
    const r = cmd('stock.buy', { id, qty });
    say(r.ok ? 'Bought ' + ITEMS[id].name.toLowerCase() + '.' : 'Not enough money.');
    // loose material comes as a thing in the yard: bags set down beside you, or a load tipped in a heap
    if (r.ok && (RC.BAGGED[id] || RC.BULK[id])) {
      // set down in front of you, where the camera looks: in plain view above the bar
      const P = G.player, fx = -Math.sin(G.cam.yaw), fz = -Math.cos(G.cam.yaw);
      let x = P.x + fx * 1.4 - fz * 0.5, z = P.z + fz * 1.4 + fx * 0.5;
      if (isWater(x, z)) { x = P.x - fx * 1.4; z = P.z - fz * 1.4; }
      const d = cmd('landscape.deliver', { item: id, qty, x, z });
      if (d.ok) {
        G.burst(x, surfaceAt(x, z) + 0.2, z, 16, d.bags ? 0x56703a : matHex(RC.BULK[id]), 1.6, 1.2, 0.07, 0.6); dirty = true;
        dropMark.x = x; dropMark.z = z; dropMark.until = performance.now() + 4000;
        // put the store away and take up the shovel: what you bought is right there in front of you
        H.hold('shovel');
        say(d.bags ? d.bags + ' bags of ' + ITEMS[id].name.toLowerCase() + ' set down in front of you. Press one with the shovel to rip it open (or drag it with Hands).' : 'A load of ' + ITEMS[id].name.replace(/ \(bulk\)/, '').toLowerCase() + ' tipped in front of you. Press the heap with the shovel and drag scoops where they go.', 7);
      }
    }
    if (on) setSlots(); renderStore();
    return r.ok;
  }
  // the yard store, by aisle
  const AISLES = [
    ['tools', 'Tools', [['trowel', 1], ['rake', 1], ['tamper', 1], ['wheelbarrow', 1], ['watering_can', 1], ['garden_hose', 1]]],
    ['install', 'Base & fabric', [['landscape_fabric', 10, '10 m2 of weed barrier'], ['crushed_stone', 0.25, '250 L: a 10 cm base for 2.5 m2'], ['sand', 0.1, '100 L: a 3 cm bed for 3 m2']]],
    ['boxes', 'Garden boxes', [['garden_box_kit', 1, 'A 1.2 x 2.4 m cedar box, 30 cm deep'], ['raised_bed_mix', 7 * RC.BAG_L, '7 bags: about half a box']]],
    ['chips', 'Wood chips & mulch', [['wood_chips', 5 * RC.BAG_L, '5 bags: a 4 m path'], ['bark_mulch', 4 * RC.BAG_L, '4 bags: 3 m2 of border'], ['grass_seed', 1, '1 kg sows 25 m2']]],
    ['gravel', 'Gravel & stone', [['gravel', 0.25, '250 L: a path 3 m long'], ['crushed_stone', 0.25, '250 L: a firm path'], ['decomposed_granite', 0.25, '250 L: a smooth path'], ['slate_chips', 0.1, '100 L'], ['marble_chips', 0.1, '100 L'], ['lava_rock', 0.1, '100 L'], ['river_rock', 0.25, '250 L: a dry creek bed'], ['sand', 0.1, '100 L: a bed for stones']]],
    ['paving', 'Paving', [['granite_sett', 100, '100 cobbles: about 1 m2'], ['flagstone_40', 2, '10 stepping stones'], ['paver_brick', 50, '50 bricks: 10 m of edging']]],
    ['walls', 'Walls & edging', [['stone', 40, '40 fieldstones: a low wall'], ['cut_stone', 30, '30 blocks: 4 m, three courses'], ['capstone', 8, '8 slabs to top a 4 m wall'], ['granite_curb', 6, '6 lengths: 5.4 m of edging'], ['landscape_timber', 10, '10 of 1.2 m: a raised bed'], ['boulder', 1, 'A feature rock']]],
    ['water', 'Ponds & lights', [['pond_liner', 6, '6 m2: a pond 1.5 m across'], ['path_light', 6, '6 solar lights']]],
    ['plants', 'Nursery', Object.keys(PLANTS).map((k) => [PLANTS[k].item, 1])],
  ];
  let aisle = 'gravel';
  const chip = (id, nm) => '<button type="button" class="gseed" data-aisle="' + id + '" style="min-width:0;flex:0 0 auto;padding:6px 10px;' + (id === aisle ? 'outline:2px solid #e6c46a;' : 'opacity:.8;') + '"><b>' + nm + '</b></button>';
  function renderStore() {
    let h = '';
    const sc = L().scale || 1;
    for (const [id, nm] of AISLES) h += chip(id, nm);
    const A = AISLES.find((x) => x[0] === aisle);
    if (aisle === 'tools') h += '<button type="button" class="gseed" data-scale="1"><b>Earth per scoop</b><span>' + [1, 2, 4].map((v) => (v === sc ? '<b style="display:inline;font-size:14px">' + v + '×</b>' : v + '×')).join(' · ') + '</span><span>' + litres(SCOOP_M3 * sc) + ' L a scoop. Click to change</span></button>';
    for (const [id, q, what] of A[2]) {
      const it = ITEMS[id];
      if (!it) continue;
      if (A[0] === 'tools') { if (!owns(id)) h += '<button type="button" class="gseed" data-buy="' + id + '" data-qty="1"><b>' + esc(it.name) + '</b><span>' + esc(it.blurb || '') + '</span><span>Buy for ' + money(it.priceUsd) + '</span></button>'; continue; }
      const pk = A[0] === 'plants' && Object.values(PLANTS).find((p) => p.item === id);
      const nm = pk ? pk.name + '<i style="background:' + PLANT_HEX[pk.id] + '"></i>' : esc(it.name.replace(/ \(bulk\)/, ''));
      const sub = pk ? esc(pk.blurb) : esc(it.blurb || '');
      const foot = (pk ? 'Hole ' + Math.round(pk.holeM * 100) + ' cm · ' : (what ? esc(what) + ' · ' : '')) + money(it.priceUsd * q) + (have(id) > 0 && it.unit === 'each' ? ' · have ' + Math.floor(have(id)) : '');
      h += '<button type="button" class="gseed" data-buy="' + id + '" data-qty="' + q + '"><b>' + nm + '</b><span>' + sub + '</span><span>' + foot + '</span></button>';
    }
    if (aisle === 'tools' && ['trowel', 'rake', 'tamper', 'wheelbarrow', 'watering_can', 'garden_hose'].every(owns)) h += '<button type="button" class="gseed" disabled><b>You have every tool</b><span>Earth per scoop is the setting above</span></button>';
    storeEl.innerHTML = h;
  }
  storeEl.addEventListener('click', (e) => {
    const b = e.target.closest('.gseed'); if (!b) return;
    if (b.dataset.aisle) { aisle = b.dataset.aisle; renderStore(); return; }
    if (b.dataset.scale) { const sc = L().scale || 1, nx = sc === 1 ? 2 : sc === 2 ? 4 : 1; cmd('landscape.setScale', { scale: nx }); renderStore(); say('Each scoop moves ' + litres(SCOOP_M3 * nx) + ' L now.'); return; }
    if (b.dataset.buy) { buy(b.dataset.buy, +b.dataset.qty); if (b.dataset.buy === 'watering_can' && ITEMS.watering_can) cmd('garden.refill', {}); }
    canvas.focus();
  });
  let hintSig = '';
  function updateHint(force) {
    const now = performance.now();
    let h;
    if (flash.msg && now < flash.until) h = esc(flash.msg);
    else {
      const id = held();
      if (id === 'store') h = 'Pick what to buy. Things you own appear on the bar.';
      else if (id === 'shovel') h = loaded() ? '<b>' + litres(L().carry.m3) + ' L</b> on the shovel: <b>press and drag</b> it where it goes, let go to drop it.' : '<b>Press</b> to dig (hold to push the blade deeper), <b>drag</b> the load where it goes, <b>let go</b> to drop it. <b>Right-drag</b> pushes earth with the flat of the blade; <b>right-click</b> pats it down. <b>Q E</b> or middle-drag turn the view, the <b>wheel</b> zooms (shift tilts).';
      else if (id === 'sod') h = '<b>Drag</b> along the grass to cut the turf off in a strip.';
      else if (id === 'barrow') h = L().barrow.m3 > 1e-6 ? '<b>' + litres(L().barrow.m3) + ' L</b> in the barrow. <b>Click</b> to shovel in more, <b>drag down</b> to tip it all out.' : '<b>Click</b> to shovel a scoop into the barrow. When it is full, walk it over and <b>drag down</b> to tip it out.';
      else if (id === 'can') h = '<b>Hold and drag down</b> to pour over new plants: water them in, and keep them moist for three weeks while they root. Fill the can at the pump or the stream.';
      else if (id === 'tamper') h = '<b>Click</b> to thump the ground, <b>hold and walk</b> to tamp a strip. Twice is firm. Tamp the dug-out earth, then again on the crushed-stone base.';
      else if (id === 'fabric') h = '<b>Hold and sweep</b> to roll fabric over dug-out ground (' + have('landscape_fabric').toFixed(0) + ' m² left). Gravel, chips and stone go on top; weeds cannot come through.';
      else if (id === 'hose') h = '<b>Click</b> a lined pond to run the hose into it, click again to stop.';
      else if (id === 'liner') h = '<b>Click</b> a dug hole to lay one sheet of liner over all of it (' + have('pond_liner').toFixed(1) + ' m² left). Dig the pond first: a shelf 20 to 30 cm deep round the edge, deeper in the middle.';
      else if (id === 'rake') h = owns('rake') ? '<b>Drag</b> over loose ground to level it.' : 'You need a rake. <button type="button" class="go" data-buy="rake">Buy ' + money(ITEMS.rake.priceUsd) + '</button>';
      else if (id === 'bedmix') h = '<b>Hold and sweep</b> over a garden box to fill it (' + Math.round(have('raised_bed_mix')) + ' L left). Fill it to the top, then hoe it in the Garden (5).';
      else if (id === 'gardenbox') h = '<b>Click</b> to set the box down, <b>R</b> turns it. Fill it with bed soil (or earth from the barrow), then hoe it into a bed.';
      else if (id === 'riverrock') h = '<b>Hold and sweep</b> river rock along a dug channel for a dry creek bed (' + amount(id) + ' left). Lay it over pond liner for a beach.';
      else if (LAYER_ITEM[id]) h = id === 'seed' ? '<b>Hold and sweep</b> over bare soil to sow lawn. It knits into turf in about three weeks.' : '<b>Hold and sweep</b> to lay ' + id + ' (' + amount(id) + ' left). Drag down to pour faster. It goes on bare soil: skim the turf first.';
      else if (THINGS[id]) h = '<b>Click</b> to set a ' + THINGS[id].name.toLowerCase() + ', <b>drag</b> to lay a line. <b>R</b> turns it.' + (THINGS[id].stack ? ' Set one on another for the next course.' : '');
      else if (id.startsWith('plant:')) { const p = PLANTS[id.slice(6)]; h = 'Dig a hole about <b>' + Math.round(p.holeM * 100) + ' cm</b> deep with the shovel, then <b>click</b> it with the ' + esc(p.name.toLowerCase()) + '.'; }
      else h = '<b>Drag</b> a bag to move it. <b>Press</b> on a stone or a plant and <b>lift</b> (drag up) to pick it up. <b>Drag</b> over a weedy path to pull the weeds.';
    }
    if (!force && h === hintSig) return;
    hintSig = h; hint.innerHTML = h;
  }
  hint.addEventListener('click', (e) => { const b = e.target.closest('[data-buy]'); if (b) buy(b.dataset.buy, 1); });
  function onHold(id) {
    storeEl.hidden = id !== 'store';
    if (id === 'store') renderStore();
    act.why = '';
    updateHint(true);
  }

  /* ================= tips: said once each ================= */
  const told = {};
  function tip(what, res) {
    if (told[what]) return;
    told[what] = 1;
    if (what === 'dug') sayS('Hold still and the blade goes deeper, for a full load. Then drag it where you want it and let go: a heap, a hill, a bank.', 6);
    else if (what === 'patted') sayS('Patted down with the back of the blade: the lumps are gone and the earth is firm. Pat a bank to shape it, or a bed to level it.', 6);
    else if (what === 'pushed') sayS('The flat of the blade pushes loose earth ahead of it and fills the hollows it passes. Push from beside a heap to flatten it; drag from its top to spread it out.', 6);
    else if (what === 'scooped') sayS((SURFACES[res.s] ? SURFACES[res.s].name : res.s) + ' on the blade. Drag it to the bed and let go. Rake it level after.', 6);
    else if (what === 'tossed') sayS('Loose earth slides down until it holds at its natural slope. Rake it level, or keep heaping.', 5);
    else if (what === 'skim') sayS('A path that lasts: dig it out 10 cm, tamp it, roll out fabric, lay crushed stone and tamp again, then the top.', 7);
    else if (what === 'loose') sayS('Set on loose ground, stones sink and tilt over the next weeks. To lay them to last: dig out, tamp, fabric, crushed stone, tamp again, then a bed of sand.', 8);
    else if (what === 'course') sayS('Course ' + res.course + '. Stagger the joints and lean the wall back a little into the bank behind it.', 5);
  }

  // the tamper: lift and drop; each thump firms the loose ground under the plate
  function thump(a) {
    const res = cmd('landscape.tamp', { x: a.x, z: a.z }); G.juice.hitStop = 0.05;
    G.burst(a.x, surfaceAt(a.x, a.z) + 0.03, a.z, 6, 0x9a8a72, 1.6, 0.5, 0.04, 0.5);
    if (!res.ok) { if (act.why !== res.reason) say(res.reason); act.why = res.reason; return; }
    act.n++;
    if (res.firm) { if (act.why !== 'firm') say('Firm. Ready for fabric, a crushed-stone base, or stone.'); act.why = 'firm'; }
  }

  /* ================= press, frame, release ================= */
  function press(a) {
    const id = held();
    act.kind = id; act.n = 0; act.lx = a.x; act.lz = a.z; act.acc = 0.16; act.why = ''; act.grab = null;
    if (id === 'shovel') return shovel.press(a);
    if (id === 'sod') return sod.press(a);
    if (id === 'can') { const GV = window.__gardenView; if (GV) { GV.bindSay(say); GV.can.press(a); } return; }
    if (id === 'barrow') { act.tipped = false; return; }
    if (id === 'tamper') { act.acc = 0; thump(a); return; }
    if (id === 'liner') {
      // one sheet over the whole hole under the hand
      const res = cmd('landscape.line', { x: a.x, z: a.z, whole: true });
      act.kind = '';
      if (!res.ok) return say(res.reason, 4);
      G.burst(a.x, surfaceAt(a.x, a.z) + 0.1, a.z, 14, 0x2a2c2d, 1.4, 0.8, 0.06, 0.5);
      return say('Lined the hole: ' + res.m2.toFixed(1) + ' m² of liner. Hide the edge under stones, then run the hose into it.', 5);
    }
    if (id === 'hose') {
      const res = cmd('landscape.hose', { x: a.x, z: a.z });
      act.kind = '';
      if (!res.ok) return say(res.reason);
      return say(res.on ? 'The hose is running into the pond: about 15 litres a minute. It turns off when the pond is full (try 10× speed).' : 'Turned the hose off.', 5);
    }
    if (id === 'rake') { if (!owns('rake')) { act.kind = ''; return say('You need a rake first.'); } cmd('landscape.rake', { x: a.x, z: a.z, r: 0.4, k: 0.6 }); return; }
    if (THINGS[id]) { act.lx = a.x; act.lz = a.z; setStone(id, a.x, a.z, ghostYaw); return; }
    if (id.startsWith('plant:')) {
      const k = id.slice(6), res = cmd('landscape.plant', { kind: k, x: a.x, z: a.z });
      if (!res.ok) return say(res.reason, 4);
      const pl = L().plants[res.id];
      G.burst(pl.x, surfaceAt(pl.x, pl.z) + 0.1, pl.z, 12, 0x5a4230, 1.4, 1.8, 0.06, 0.5);
      say('Planted. Water it in, and it fills out over ' + (PLANTS[k].years > 5 ? 'many years' : PLANTS[k].years + ' years') + '.');
      return;
    }
    act.drag = null;
    if (id === 'hands') { const t = nearestThing(a.x, a.z); if (t && t.o.k === 'bag') act.drag = t.o.id; else if (t) act.grab = t; else { const q = RD.groundAt(G.sim.state, a.x, a.z); act.weeding = !!(q && q.weeds); } }
  }
  function frame(a, dt) {
    const id = held();
    // the ghost of the stone in hand
    if (THINGS[id] && a.valid) {
      const th = THINGS[id], at = stoneAt(id, a.x, a.z);
      if (ghost.geometry !== stones[id].geometry) ghost.geometry = stones[id].geometry;
      ghost.visible = true; ghost.position.set(at.below ? at.x : a.x, at.y, at.below ? at.z : a.z); ghost.rotation.set(0, at.yaw ?? ghostYaw, 0);
      ghostMat.color.setHex(have(th.item) >= th.qty - 1e-9 ? 0xfff2c4 : 0xf0a080);
    } else ghost.visible = false;
    if (!a.down) return;
    const k = act.kind;
    if (k === 'shovel') shovel.frame(a, dt);
    if (k === 'sod') sod.frame(a);
    else if (k === 'can') { const GV = window.__gardenView; if (GV) GV.can.frame(a, dt); }
    else if (k === 'barrow') {
      if (!act.tipped && a.tip > 0.45) {
        act.tipped = true;
        const res = cmd('landscape.tip', { x: a.x, z: a.z });
        if (!res.ok) return say(res.reason);
        const y = surfaceAt(a.x, a.z);
        G.burst(a.x, y + 0.3, a.z, 24, matHex(res.s), 1.8, 1.4, 0.07, 0.7);
        setHeap(); say('Tipped out ' + litres(res.m3) + ' L.');
      }
    }

    else if (k === 'rake') rakeFrame(a);
    else if (k === 'tamper') { act.acc += dt; if (act.acc >= 0.3) { act.acc = 0; thump(a); } }
    else if (k === 'fabric') {
      act.acc += dt;
      if (act.acc >= 0.15) { act.acc = 0; const res = cmd('landscape.fabric', { x: a.x, z: a.z, r: 0.4 }); if (!res.ok) { if (act.why !== res.reason) say(res.reason, 4); act.why = res.reason; } else { act.n += res.m2; } }
    }
    else if (k === 'hands' && act.drag) {
      // a bag is dragged along the ground behind the hand
      if (Math.hypot(a.x - act.lx, a.z - act.lz) < 0.12 || isWater(a.x, a.z)) return;
      act.lx = a.x; act.lz = a.z;
      const res = cmd('landscape.moveThing', { id: act.drag, x: a.x, z: a.z });
      if (!res.ok) { if (act.why !== res.reason) say(res.reason); act.why = res.reason; act.drag = null; return; }
      act.n++; dirty = true;
      if (act.n % 3 === 0) G.burst(a.x, surfaceAt(a.x, a.z) + 0.04, a.z, 2, 0x8a7a5a, 0.6, 0.4, 0.03, 0.3);
    }
    else if (k === 'hands' && !act.grab && act.weeding) {
      act.acc += dt;
      if (act.acc >= 0.15) { act.acc = 0; const res = cmd('landscape.weed', { x: a.x, z: a.z }); if (res.ok) { act.n++; G.burst(a.x, surfaceAt(a.x, a.z) + 0.1, a.z, 5, 0x5f8f36, 1.2, 1.8, 0.04, 0.5); } }
    }
    else if (LAYER_ITEM[k]) pourFrame(a, dt, k);
    else if (THINGS[k]) stoneFrame(a, k);
    else if (k === 'hands' && act.grab && a.lift > 0.45) {
      const t = act.grab; act.grab = null;
      const res = t.kind === 'plant' ? cmd('landscape.lift', { id: t.o.id }) : cmd('landscape.take', { id: t.o.id });
      if (!res.ok) return say(res.reason);
      G.burst(t.o.x, surfaceAt(t.o.x, t.o.z) + 0.15, t.o.z, 8, t.kind === 'plant' ? 0x5a4230 : 0x8f887a, 1.2, 1.6, 0.05, 0.5);
      say(t.kind === 'plant' ? 'Lifted the ' + PLANTS[res.kind].name.toLowerCase() + ', root ball and all. It is back in its pot.' : 'Picked up the ' + THINGS[res.kind].name.toLowerCase() + '.');
    }
  }
  function release(a) {
    const k = act.kind;
    if (k === 'shovel') return shovel.release(a);
    if (k === 'sod') return sod.release(a);
    if (k === 'can') { const GV = window.__gardenView; if (GV) GV.can.release(a); act.kind = ''; return; }
    if (k === 'barrow' && !act.tipped) {
      act.kind = '';
      if (isWater(a.x, a.z)) return say('That is water.');
      const res = cmd('landscape.load', { x: a.x, z: a.z });
      if (!res.ok) return say(res.reason);
      const y = surfaceAt(a.x, a.z);
      G.burst(a.x, y + 0.12, a.z, 10, matHex(res.s), 1.5, 2.2, 0.07, 0.6);
      if (res.turf) G.burst(a.x, y + 0.12, a.z, 5, 0x5e8a3a, 1.6, 2.6, 0.07, 0.7);
      setHeap();
      return say(res.full ? 'The barrow is full: ' + litres(res.load) + ' L. Walk it over and drag down to tip it out.' : 'In the barrow: ' + litres(res.load) + ' of ' + litres(RD.BARROW_M3) + ' L.');
    }
    if (k === 'hands' && act.drag && !act.n) say('Drag the bag where you want it, then rip it open with the shovel.');
    if (k === 'hands' && act.grab) say('Lift it: drag up.');
    if (k === 'hands' && act.weeding && act.n) say('Pulled the weeds. Fabric under the next path keeps them from coming back.');
    if (k === 'fabric' && act.n) say('Rolled out ' + act.n.toFixed(1) + ' m² of fabric. Now the crushed stone base, or gravel or chips straight on top.', 5);
    act.kind = ''; act.grab = null;
    updateHint(true);
  }

  /* ================= the name tag: what the aimed ground is ================= */
  let tagSig = '';
  function updateTag(a) {
    if (!on || !a.valid) { if (!label.hidden) label.hidden = true; tagSig = ''; return; }
    const q = RD.groundAt(G.sim.state, a.x, a.z), id = held();
    let t = '';
    if (q) {
      // what the ground is, and how it was put in: the install steps read off as you go
      const cm = Math.round(q.h * 100), name = SURFACES[q.s] ? SURFACES[q.s].name : q.s === '' ? 'Turf' : q.s === 'lawn_sown' ? 'Sown lawn' : 'Bare earth';
      t = name + (q.l > 0.005 ? ' ' + Math.round(q.l * 100) + ' cm' : '') + (cm <= -2 ? ' · dug ' + -cm + ' cm' : cm >= 2 ? ' · raised ' + cm + ' cm' : '');
      if (q.fabric) t += ' · on fabric';
      if (q.tamped) t += q.tamped >= 2 ? ' · tamped firm' : ' · tamped once';
      if (q.weeds >= 2) t += ' · weedy';
      if (q.boxed) t += ' · in the box';
    }
    const near = Object.values(L().plants).find((pl) => Math.hypot(pl.x - a.x, pl.z - a.z) < 0.35);
    if (near && !id.startsWith('plant:')) {
      const z = RD.plantSize(G.sim.state, near.id), pk = PLANTS[near.k];
      t = pk.name + ': ' + (pk.wet ? 'growing in the shallows' : z.wilt ? 'wilting, water it' : z.thirsty ? 'thirsty' : !z.rooted ? 'rooting in, keep it moist' : z.k > 0.85 ? 'full grown' : 'growing') + ' · ' + Math.round(z.h * 100) + ' cm';
    }
    const pd = q && q.liner && RD.pondsOf(G.sim.state).find((p) => p.pts.some(([i, j]) => Math.abs(i * STEP - a.x) < 0.11 && Math.abs(j * STEP - a.z) < 0.11));
    if (pd) t = 'Pond · ' + litres(pd.m3) + ' of ' + litres(pd.cap) + ' L' + (pd.m3 > 0 ? ' · ' + Math.max(0, Math.round((pd.level - q.h) * 100)) + ' cm deep here' : ' · empty') + (pd.hose ? ' · filling' : '');
    if (id.startsWith('plant:') && PLANTS[id.slice(6)].wet) t = pd && pd.m3 > 0 ? 'Water ' + Math.max(0, Math.round((pd.level - q.h) * 100)) + ' cm deep: 5 to 25 is right' : 'An iris goes in the shallows of a filled pond';
    else if (id.startsWith('plant:')) {
      const p = PLANTS[id.slice(6)];
      let d = 0;
      for (let k = 0; k < 9; k++) d = Math.max(d, -RD.reliefAt(G.sim.state, a.x + ((k % 3) - 1) * 0.1, a.z + (Math.floor(k / 3) - 1) * 0.1));
      t = d >= p.holeM * 0.8 ? 'Deep enough: click to plant' : 'Hole ' + Math.round(d * 100) + ' of ' + Math.round(p.holeM * 100) + ' cm';
    }
    if (!t) { if (!label.hidden) label.hidden = true; tagSig = ''; return; }
    if (t !== tagSig) { tagSig = t; label.textContent = t; label.classList.toggle('warn', /^Hole \d|weedy|wilting/.test(t)); }
    label.hidden = false;
    const sc = H.toScreen(a.x, a.y + 0.25, a.z, {});
    label.style.transform = 'translate(' + Math.round(sc.x + 18) + 'px,' + Math.round(sc.y - 28) + 'px)';
  }
  // path lights glow with the dusk
  let glowK = -1;
  function glow() {
    const k = Math.max(0, Math.min(1, (G.nightF ?? 0) * 1.4));
    if (Math.abs(k - glowK) < 0.01) return;
    glowK = k; lensMat.color.copy(LENS).multiplyScalar(0.05 + k);
  }

  /* ================= taking up the yard tools, and putting them away ================= */
  let on = false, lastHeld = 'shovel', mySlots = null;
  const setSlots = () => { mySlots = slotList(); H.setSlots(mySlots); };
  function enter() {
    on = true; document.body.classList.add('gardening', 'yarding'); bar.hidden = false; shovelSay = null;
    mySlots = slotList();
    H.open({ bar: toolsEl, reach: 2.0, camDist: 7.5, camPitch: 0.98, camFree: true, pace: 0.55, tipPx: 90, liftPx: 70, slots: mySlots, held: lastHeld, onHold, press, frame, release, alt: (cur) => !!cur && cur.id === 'shovel' });
    onHold(held()); setHeap();
  }
  function leave() {
    lastHeld = held() === 'store' ? 'shovel' : held();
    if (window.__gardenView && window.__gardenView.bindSay) window.__gardenView.bindSay(null);
    on = false; document.body.classList.remove('yarding'); if (G.player.tool !== 'garden') document.body.classList.remove('gardening');
    bar.hidden = true; storeEl.hidden = true; ghost.visible = false; label.hidden = true;
    if (H.slots === mySlots) H.close();          // unless the garden has already taken the hands up
  }
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (G.player.tool === 'build') return;
    if (e.code === 'Digit6' && !e.repeat && !H.isOpen) { G.setTool('yard'); e.preventDefault(); }
    else if (on && e.code === 'KeyR' && !e.repeat) { ghostYaw += (e.shiftKey ? -1 : 1) * Math.PI / 12; e.preventDefault(); }
    else if (on && e.code === 'Escape') G.setTool('axe');
  }, true);

  /* ================= every frame (cheap) and four times a second ================= */
  let last = performance.now(), slow = 0, fastT = 0;
  function tick(t) {
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    const want = G.player.tool === 'yard';
    if (want !== on) { if (want) enter(); else leave(); }
    if (on) updateTag(H.aim);
    if (hoseMeshes.size) hoseSpray();
    grainTick(dt);
    if (groundMoved) { fastT += dt; if (fastT > 0.07) { fastT = 0; groundMoved = false; refreshGround(false, true); } }
    digTick(dt); patTick(dt); markTick(dt);
    slow += dt;
    if (slow > 0.25 || dirty) {
      slow = 0; dirty = false;
      if (!refreshGround(false) && maskDue) { maskDue = false; paintMask(true); hideGrass(true); }
      paintMask(false);
      layoutStones();
      if ((plantT += 1) % 8 === 0) layoutPlants(true); else layoutPlants(false);
      hideGrass(false);
      layoutPonds();
      glow();
      if (on) { setSlots(); updateHint(); }
    }
    requestAnimationFrame(tick);
  }
  G.sim.listen((type) => { if (type === 'loaded') { groundRev = -1; stoneSig = ''; plantSig = ''; tilesRev = -1; dirty = true; setHeap(); } });
  requestAnimationFrame(tick);

  window.__landscape = {
    relief, surfaceAt, tools: { shovel }, items: { shovel: ITEM.shovel }, setHeap, bindSay: (fn) => { shovelSay = fn; }, get rev() { return grid().rev; },
    maskAt: (x, z) => { const i = Math.floor(x / STEP) - maskI, j = Math.floor(z / STEP) - maskJ; return i >= 0 && j >= 0 && i < MN && j < MN ? maskData[j * MN + i] : -1; }, drawnAt: (x, z) => drawn.has(qKey(Math.floor(x / STEP), Math.floor(z / STEP))),
    get on() { return on; }, get flying() { return grainsBusy() || !!dig.ph || slides.size > 0; }, get dig() { return dig.ph; }, get grainN() { return grains.length; }, get slideN() { return slides.size; }, hold: (id) => H.hold(id), refresh: () => { dirty = true; refreshGround(true); layoutStones(); layoutPlants(true); }, tiles: () => tileViews.size,
  };
})();
