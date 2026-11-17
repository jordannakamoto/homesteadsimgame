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
  const { SURFACES, THINGS, PLANTS, SCOOP_M3 } = RD;
  const CELL = 0.3, TILE = 16, CS = G.chunkSize || 32;
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

  /* ================= the shape of the ground, for everyone ================= */
  // tiles (16 x 16 squares) that hold a worked square or touch one, so the relief lookup can skip untouched ground fast
  const tileKey = (tx, tz) => (tx + 32768) * 65536 + (tz + 32768);
  const tiles = new Set();
  let tilesRev = -1;
  function syncTiles() {
    const g = grid();
    if (g.rev === tilesRev) return;
    tilesRev = g.rev; tiles.clear();
    for (const k in g.sq) {
      const i = k.indexOf(','), gx = +k.slice(0, i), gz = +k.slice(i + 1);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) tiles.add(tileKey(Math.floor((gx + dx) / TILE), Math.floor((gz + dz) / TILE)));
    }
  }
  function relief(x, z) {
    syncTiles();
    if (!tiles.size || !tiles.has(tileKey(Math.floor(x / CELL / TILE), Math.floor(z / CELL / TILE)))) return 0;
    return EW.reliefAt(grid(), x, z);
  }
  const surfaceAt = (x, z) => G.heightAt(x, z) + relief(x, z);
  G.setRelief(relief);
  G.surfaceAt = surfaceAt;

  // a garden bed's worked squares are drawn by the garden view (src/garden-view.js), with this relief added
  function bedTilled(gx, gz) {
    const g = GS();
    if (!g || !g.field) return false;
    const x = (gx + 0.5) * CELL, z = (gz + 0.5) * CELL;
    for (const b of Object.values(g.field.groups)) {
      const ix = Math.floor((x - b.x0) / CELL), iz = Math.floor((z - b.z0) / CELL);
      if (ix >= 0 && iz >= 0 && ix < b.nx && iz < b.nz) { const c = b.cells[iz * b.nx + ix]; return c.till === undefined || c.till > 0; }
    }
    return false;
  }
  // worth drawing: any surface other than turf, or turf moved more than a few centimetres
  const shown = (q) => !!q && (q[1] !== '' || Math.abs(q[0]) >= 0.03);

  /* ================= the ground mesh, tile by tile ================= */
  const groundMat = new T.MeshLambertMaterial({ vertexColors: true });
  const tileViews = new Map();    // tileKey -> { mesh, sig }
  const COL = {
    soil: new T.Color(0x5e4632), soilDry: new T.Color(0x86704f), gravel: new T.Color(0xa49d90), gravelDark: new T.Color(0x6f6a62), bark: new T.Color(0x5a3626), barkLight: new T.Color(0x8a5a3a),
    sand: new T.Color(0xd8c79a), sod: new T.Color(0x56732f), sodDark: new T.Color(0x3f5a26), sprout: new T.Color(0x6f9a3a), skirt: new T.Color(0x3d2c1f),
    rock: new T.Color(0x8c8478), rockDark: new T.Color(0x5f5a52), liner: new T.Color(0x232526),
  };
  const _c = new T.Color(), _c2 = new T.Color();
  // the colour of one point of a square's surface: its material, grained by a fixed speckle, darker down in a hole
  function pointColour(q, gx, gz, k, depth, lifeT) {
    const r = hash(gx * 7 + k, gz * 13 + k * 3), s = q[1];
    if (s === 'gravel') _c.copy(r < 0.35 ? COL.gravelDark : COL.gravel).multiplyScalar(0.85 + 0.3 * hash(k, gx + gz));
    else if (s === 'bark') _c.copy(r < 0.5 ? COL.bark : COL.barkLight).multiplyScalar(0.85 + 0.25 * hash(k + 1, gz));
    else if (s === 'sand') _c.copy(COL.sand).multiplyScalar(0.93 + 0.12 * r);
    else if (s === 'riverrock') _c.copy(r < 0.5 ? COL.rockDark : COL.rock).multiplyScalar(0.8 + 0.3 * hash(k + 2, gx));
    else if (L().liner[gx + ',' + gz]) _c.copy(COL.liner).multiplyScalar(0.85 + 0.3 * r);
    else if (s === '') _c.copy(r < 0.4 ? COL.sodDark : COL.sod).multiplyScalar(0.9 + 0.15 * hash(gx, k));
    else {
      _c.copy(COL.soil).lerp(COL.soilDry, 0.35 + 0.3 * hash(gx + k, gz)).multiplyScalar(r < 0.08 ? 1.25 : r > 0.9 ? 0.75 : 0.95);
      if (s === 'lawn_sown') {
        const age = clamp((lifeT - q[3]) / (RD.LAWN.coverDays * 86400), 0, 1);
        if (hash(k * 3 + gx, gz * 5) < 0.15 + 0.85 * age) _c.lerp(COL.sprout, 0.35 + 0.5 * age);
      }
    }
    return _c.multiplyScalar(1 + clamp(depth * 1.6, -0.45, 0));
  }
  const SUBP = [0, 1, 2];
  function buildTile(tx, tz, lifeT) {
    const g = grid(), pos = [], col = [];
    const gx0 = tx * TILE, gz0 = tz * TILE;
    const ownTile = (gx, gz) => shown(EW.square(g, gx, gz)) && !bedTilled(gx, gz);
    let any = false;
    for (let gz = gz0; gz < gz0 + TILE; gz++) for (let gx = gx0; gx < gx0 + TILE; gx++) {
      const q = EW.square(g, gx, gz);
      if (!shown(q) || bedTilled(gx, gz)) continue;
      any = true;
      // the 3 x 3 lattice points of this square: corners, edge middles and centre
      const P = [];
      for (const b of SUBP) for (const a of SUBP) {
        const i = gx * 2 + a, j = gz * 2 + b, x = i * CELL / 2, z = j * CELL / 2, h = EW.latticeH(g, i, j);
        P.push([x, G.heightAt(x, z) + h + 0.004, z, h]);
      }
      let k = 0;
      const put = (p, extra = 0) => { pos.push(p[0], p[1] - extra, p[2]); const c = extra ? _c2.copy(COL.skirt) : pointColour(q, gx, gz, k, p[3], lifeT); col.push(c.r, c.g, c.b); k++; };
      for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
        const p00 = P[b * 3 + a], p10 = P[b * 3 + a + 1], p01 = P[(b + 1) * 3 + a], p11 = P[(b + 1) * 3 + a + 1];
        put(p00); put(p01); put(p10); put(p10); put(p01); put(p11);
      }
      // skirts where this square meets ground the terrain or a bed draws: they hide any hairline between the meshes
      const edge = (pa, pb, mid) => { put(pa); put(pa, 0.3); put(mid); put(mid); put(pa, 0.3); put(mid, 0.3); put(mid); put(mid, 0.3); put(pb); put(pb); put(mid, 0.3); put(pb, 0.3); };
      if (!ownTile(gx, gz - 1)) edge(P[2], P[0], P[1]);
      if (!ownTile(gx, gz + 1)) edge(P[6], P[8], P[7]);
      if (!ownTile(gx - 1, gz)) edge(P[0], P[6], P[3]);
      if (!ownTile(gx + 1, gz)) edge(P[8], P[2], P[5]);
    }
    if (!any) return null;
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('color', new T.BufferAttribute(new Float32Array(col), 3));
    geo.computeVertexNormals();
    const m = new T.Mesh(geo, groundMat);
    m.receiveShadow = true; m.castShadow = true;
    const d = detailFor(gx0, gz0, g);
    if (d) m.add(d);
    return m;
  }
  // Pebbles in the gravel, cobbles in a creek bed, chips in the bark: small shapes scattered over each square of a
  // laid layer (a fixed pattern per square), built with the tile and drawn with it.
  const DETAIL = {
    gravel: { n: 9, geo: new T.OctahedronGeometry(1, 0), size: [0.018, 0.034], flat: 0.55, cols: [0xb5ada0, 0x8d877d, 0x6f6a62, 0xc8bfae] },
    riverrock: { n: 5, geo: new T.IcosahedronGeometry(1, 0), size: [0.04, 0.085], flat: 0.5, cols: [0x9a9286, 0x6d675e, 0xb3a690, 0x7d6d5a, 0x5c5f5c] },
    bark: { n: 8, geo: new T.BoxGeometry(2, 0.35, 1), size: [0.018, 0.034], flat: 1, cols: [0x6a412c, 0x8a5a3a, 0x4e2e1f] },
  };
  for (const k in DETAIL) DETAIL[k].pos = DETAIL[k].geo.toNonIndexed().attributes.position.array;
  function detailFor(gx0, gz0, g) {
    const pos = [], col = [];
    for (let gz = gz0; gz < gz0 + TILE; gz++) for (let gx = gx0; gx < gx0 + TILE; gx++) {
      const q = EW.square(g, gx, gz);
      if (!q || !DETAIL[q[1]] || bedTilled(gx, gz)) continue;
      const D = DETAIL[q[1]], src = D.pos;
      for (let i = 0; i < D.n; i++) {
        const x = (gx + 0.06 + 0.88 * hash(gx * 31 + i, gz * 17)) * CELL, z = (gz + 0.06 + 0.88 * hash(gz * 29 + i, gx * 13 + 7)) * CELL;
        const sz = D.size[0] + (D.size[1] - D.size[0]) * hash(i * 7 + gx, gz * 3), yaw = hash(gx + i * 3, gz + i) * 6.28, cy = Math.cos(yaw), sy = Math.sin(yaw);
        const y = G.heightAt(x, z) + EW.reliefAt(g, x, z) + 0.004 + sz * D.flat * 0.3;
        const c = _c.setHex(D.cols[Math.floor(hash(i + gx * 5, gz * 11 + i) * D.cols.length)]);
        for (let v = 0; v < src.length; v += 3) {
          const lx = src[v] * sz, ly = src[v + 1] * sz * D.flat, lz = src[v + 2] * sz * 0.8;
          pos.push(x + lx * cy - lz * sy, y + ly, z + lx * sy + lz * cy);
          col.push(c.r, c.g, c.b);
        }
      }
    }
    if (!pos.length) return null;
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('color', new T.BufferAttribute(new Float32Array(col), 3));
    geo.computeVertexNormals();
    const m = new T.Mesh(geo, groundMat); m.receiveShadow = true;
    return m;
  }
  function tileSig(tx, tz, lifeT) {
    const g = grid();
    let s = '';
    for (let gz = tz * TILE - 1; gz <= tz * TILE + TILE; gz++) for (let gx = tx * TILE - 1; gx <= tx * TILE + TILE; gx++) {
      const q = EW.square(g, gx, gz);
      if (!q) continue;
      s += gx + ',' + gz + ':' + q[0] + q[1] + (q[1] === 'lawn_sown' ? Math.floor((lifeT - q[3]) / 86400 / 3) : '') + (bedTilled(gx, gz) ? 'b' : '') + (L().liner[gx + ',' + gz] ? 'L' : '') + ';';
    }
    return s;
  }
  let groundRev = -1, bedSigSeen = '', heightSig = '';
  function bedsSig() {
    const g = GS(); if (!g || !g.field) return '';
    let s = ''; for (const b of Object.values(g.field.groups)) { s += b.id + b.x0 + b.z0 + b.nx + b.nz; for (const c of b.cells) s += c.till === undefined ? 1 : c.till > 0 ? 1 : 0; }
    return s;
  }
  function refreshGround(force) {
    const g = grid(), lifeT = G.sim.state.lifeT, bs = bedsSig();
    // the terrain under the tiles can change too (Dig, Raise and Level, felled trees): watch its edit count
    const hs = G.world ? G.world.edits.size + ':' + Math.floor(lifeT / 86400 / 3) : '';
    if (!force && g.rev === groundRev && bs === bedSigSeen && hs === heightSig) return false;
    groundRev = g.rev; bedSigSeen = bs; heightSig = hs;
    const want = new Set();
    for (const k in g.sq) { const i = k.indexOf(','), gx = +k.slice(0, i), gz = +k.slice(i + 1); want.add(Math.floor(gx / TILE) + ':' + Math.floor(gz / TILE)); }
    for (const [key, v] of [...tileViews]) if (!want.has(key)) { if (v.mesh) { G.scene.remove(v.mesh); v.mesh.geometry.dispose(); for (const ch of v.mesh.children) ch.geometry.dispose(); } tileViews.delete(key); }
    for (const key of want) {
      const [tx, tz] = key.split(':').map(Number), sig = tileSig(tx, tz, lifeT), v = tileViews.get(key);
      if (v && v.sig === sig && !force) continue;
      if (v && v.mesh) { G.scene.remove(v.mesh); v.mesh.geometry.dispose(); for (const ch of v.mesh.children) ch.geometry.dispose(); }
      const m = buildTile(tx, tz, lifeT);
      if (m) G.scene.add(m);
      tileViews.set(key, { mesh: m, sig });
    }
    paintMask(true);
    hideGrass(true);
    return true;
  }

  /* ================= the dig mask: where the terrain lets the shaped ground show ================= */
  const MN = 512;
  const maskData = new Uint8Array(MN * MN);
  const maskTex = new T.DataTexture(maskData, MN, MN, T.RedFormat, T.UnsignedByteType);
  maskTex.magFilter = maskTex.minFilter = T.NearestFilter; maskTex.generateMipmaps = false;
  let maskGx = 0, maskGz = 0, maskOn = false;
  function paintMask(force) {
    const g = grid(), P = G.player;
    const cgx = Math.floor(P.x / CELL), cgz = Math.floor(P.z / CELL);
    const moved = Math.abs(cgx - (maskGx + MN / 2)) > 90 || Math.abs(cgz - (maskGz + MN / 2)) > 90;
    if (!force && !moved) return;
    let any = false;
    for (const k in g.sq) if (shown(g.sq[k])) { any = true; break; }
    if (!any && !maskOn) return;
    maskGx = cgx - MN / 2; maskGz = cgz - MN / 2;
    maskData.fill(0);
    for (const k in g.sq) {
      if (!shown(g.sq[k])) continue;
      const i = k.indexOf(','), x = +k.slice(0, i) - maskGx, z = +k.slice(i + 1) - maskGz;
      if (x >= 0 && z >= 0 && x < MN && z < MN) maskData[z * MN + x] = 255;
    }
    maskTex.needsUpdate = true;
    G.digMask.win.value.set(maskGx * CELL, maskGz * CELL, CELL, MN);
    if (!maskOn) { G.digMask.enable(maskTex); maskOn = true; }
  }

  /* ================= grass: hidden on worked squares, back when the turf is ================= */
  const ZERO = new T.Matrix4().makeScale(0, 0, 0);
  const grassRec = new WeakMap();   // mesh -> { list, orig: Float32Array, hid: Set, ver }
  const chunkHas = new Set(); let chunkRev = -1;
  function hideGrass(force) {
    const chunks = G.world && G.world.chunks, g = grid();
    if (!chunks) return;
    if (chunkRev !== g.rev) {
      chunkRev = g.rev; chunkHas.clear();
      for (const k in g.sq) { const i = k.indexOf(','); chunkHas.add(Math.floor(+k.slice(0, i) * CELL / CS) + ',' + Math.floor(+k.slice(i + 1) * CELL / CS)); }
    }
    for (const c of chunks.values()) {
      // only chunks that hold a worked square, or did
      const near = chunkHas.has(Math.round(c.ox / CS) + ',' + Math.round(c.oz / CS));
      for (const [mesh, list] of [[c.grassMesh, c.grass], [c.flowerMesh, c.flowers]]) {
        if (!mesh || !list) continue;
        let rec = grassRec.get(mesh);
        if (!near && !(rec && rec.hid.size)) continue;
        const arr = mesh.instanceMatrix.array;
        if (!rec || rec.list !== list || rec.orig.length !== arr.length) { rec = { list, orig: new Float32Array(arr), hid: new Set(), ver: -1 }; grassRec.set(mesh, rec); }
        else if (rec.ver !== mesh.instanceMatrix.version) {
          // someone else (the garden) wrote to the matrices: take their values as the originals, except the ones we hid
          for (let i = 0; i < list.length; i++) if (!rec.hid.has(i)) for (let j = 0; j < 16; j++) rec.orig[i * 16 + j] = arr[i * 16 + j];
        } else if (!force) continue;
        let n = 0;
        list.forEach((gr, i) => {
          const gx = Math.floor((c.ox + gr.lx) / CELL), gz = Math.floor((c.oz + gr.lz) / CELL), q = g.sq[gx + ',' + gz];
          const hide = shown(q) && !bedTilled(gx, gz);
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
    if (kind === 'timber') return merge([part(box(d.w, d.h, d.d), 0x7a6146, 0, d.h / 2, 0), part(box(d.w * 0.98, 0.004, d.d * 0.7), 0x8d7152, 0, d.h + 0.001, 0), part(box(0.004, d.h * 0.9, d.d * 0.9), 0xa88b66, d.w / 2 + 0.001, d.h / 2, 0), part(box(0.004, d.h * 0.9, d.d * 0.9), 0xa88b66, -d.w / 2 - 0.001, d.h / 2, 0)]);
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
  const stoneY = (o) => G.heightAt(o.ax, o.az) + o.y;
  function layoutStones() {
    const list = Object.values(L().things);
    let sig = list.length + ':'; for (const o of list) sig += o.id + ',';
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
        m.setColorAt(i, _ic.setScalar(0.85 + 0.3 * hash(n, 7)));
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
  const pondTop = (pd) => { let s = 0; for (const [gx, gz] of pd.cells) s += G.heightAt((gx + 0.5) * CELL, (gz + 0.5) * CELL); return s / pd.cells.length + pd.level; };
  function layoutPonds() {
    const list = RD.pondsOf(G.sim.state), seen = new Set();
    for (const pd of list) {
      seen.add(pd.root);
      const sig = pd.cells.length + ':' + Math.round(pd.m3 * 200) + ':' + groundRev;
      let v = pondViews.get(pd.root);
      if (!v || v.sig !== sig) {
        if (v && v.mesh) { G.scene.remove(v.mesh); v.mesh.geometry.dispose(); }
        let mesh = null;
        if (pd.m3 > 1e-4) {
          const y = pondTop(pd) + 0.002, pos = [], g = grid();
          for (const [gx, gz] of pd.cells) {
            if (EW.heightOf(g, gx, gz) >= pd.level - 0.002) continue;
            const x0 = gx * CELL - 0.02, x1 = (gx + 1) * CELL + 0.02, z0 = gz * CELL - 0.02, z1 = (gz + 1) * CELL + 0.02;
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
        const [gx, gz] = pd.cells[0], x = gx * CELL - 0.15, z = gz * CELL - 0.15;
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
      const pd = h.userData.pd, [gx, gz] = pd.cells[0], x = (gx + 0.5) * CELL, z = (gz + 0.5) * CELL;
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
  // the wheelbarrow: tray, one wheel, two handles; a heap in the tray as it fills
  {
    const tray = new T.CylinderGeometry(0.42, 0.3, 0.26, 4, 1, true); tray.rotateY(Math.PI / 4);
    const obj = mesh([part(tray, 0x2f6e8e, 0, 0.38, 0, 0, 0, 0, 1, 1, 1.35), part(box(0.5, 0.02, 0.6), 0x2a5f7a, 0, 0.25, 0), part(new T.CylinderGeometry(0.17, 0.17, 0.09, 12), 0x222222, 0, 0.17, 0.62, 0, 0, Math.PI / 2), part(stick(1.3, 0.02, 5), 0x8a6a45, 0.22, 0.2, 0.55, -1.42, 0, 0), part(stick(1.3, 0.02, 5), 0x8a6a45, -0.22, 0.2, 0.55, -1.42, 0, 0), part(stick(0.22, 0.015, 4), 0x444444, 0.2, 0, -0.25), part(stick(0.22, 0.015, 4), 0x444444, -0.2, 0, -0.25)]);
    obj.scale.setScalar(0.8); obj.rotation.y = Math.PI;
    const heap = new T.Mesh(ball(0.3, 1), new T.MeshLambertMaterial({ color: 0x5e4632 })); heap.position.set(0, 0.42, 0); heap.visible = false; obj.add(heap);
    const g = new T.Group(); g.add(obj);
    ITEM.barrow = { obj: g, heap, use: 'hand', still: [0, 0.05, 0.65, 0, 0, 0], reach: [0, 0.05, 0.75, 0, 0, 0], stillArm: -0.4 };
  }
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
  const sqOf = (x, z) => [Math.floor(x / CELL), Math.floor(z / CELL)];
  const loaded = () => L().carry.m3 > 1e-6;
  const isWater = (x, z) => G.heightAt(x, z) < (G.sea ?? -0.2) + 0.05 || !!(G.streamWaterAt && G.streamWaterAt(x, z));
  const litres = (m3) => Math.round(m3 * 1000);
  const matHex = (s) => (s === 'gravel' ? 0xa49d90 : s === 'bark' ? 0x6a412c : s === 'sand' ? 0xd8c79a : s === 'riverrock' ? 0x8c8478 : 0x5e4632);
  function setHeap() {
    const b = L().barrow, bh = ITEM.barrow && ITEM.barrow.heap;
    if (bh) { bh.visible = b.m3 > 1e-6; if (bh.visible) { bh.material.color.setHex(matHex(b.s)); const f = Math.min(1, b.m3 / RD.BARROW_M3); bh.scale.set(0.6 + 0.5 * f, 0.15 + 0.5 * f, 0.8 + 0.5 * f); } }
    const c = L().carry, it = ITEM.shovel;
    it.heap.visible = c.m3 > 1e-6;
    if (it.heap.visible) { it.heap.material.color.setHex(c.s === 'gravel' ? 0xa49d90 : c.s === 'bark' ? 0x6a412c : c.s === 'sand' ? 0xd8c79a : 0x5e4632); it.heap.scale.set(1, 0.4 + 0.25 * Math.min(2, c.m3 / SCOOP_M3 / 2), 1); }
  }
  // the shovel, shared with the garden: click to dig a scoop or toss the load; drag along the ground to skim turf
  const shovel = {
    press(a) {
      act.kind = 'shovel'; act.n = 0; act.lx = a.x; act.lz = a.z; act.skim = false; act.tossed = false; skimmed.clear();
      if (!owns('shovel') && !owns('spade')) { act.kind = ''; return sayS('You need a shovel.'); }
      G.cam.shake = Math.min(G.cam.shake + 0.1, 0.4); G.juice.hitStop = 0.04;
      if (loaded()) {
        const c = L().carry, res = cmd('landscape.dump', { x: a.x, z: a.z });
        act.tossed = true;
        if (!res.ok) return sayS(res.reason);
        const y = surfaceAt(a.x, a.z), hex = c.s === 'gravel' ? 0xa49d90 : c.s === 'bark' ? 0x6a412c : c.s === 'sand' ? 0xd8c79a : 0x5e4632;
        G.burst(a.x, y + 0.35, a.z, 14, hex, 1.4, 1.2, 0.07, 0.6);
        G.burst(a.x, y + 0.08, a.z, 8, hex, 1.8, 2.2, 0.05, 0.45);
        setHeap(); tip('tossed', res);
      }
    },
    frame(a) {
      if (act.kind !== 'shovel' || act.tossed) return;
      if (!act.skim && Math.hypot(a.x - a.ox, a.z - a.oz) > 0.22 && a.held < 0.9) act.skim = true;
      if (!act.skim) return;
      // skimming: the blade slides under the turf along the drag; every square it passes is lifted off
      const len = Math.hypot(a.x - act.lx, a.z - act.lz), n = Math.max(1, Math.ceil(len / 0.1)), cells = [];
      for (let i = 0; i <= n; i++) {
        const x = act.lx + ((a.x - act.lx) * i) / n, z = act.lz + ((a.z - act.lz) * i) / n, [gx, gz] = sqOf(x, z), k = gx + ',' + gz;
        if (skimmed.has(k) || isWater(x, z)) continue;
        skimmed.add(k); cells.push([gx, gz]);
      }
      act.lx = a.x; act.lz = a.z;
      if (!cells.length) return;
      const res = cmd('landscape.skim', { cells });
      if (!res.ok) { if (!act.why) sayS(res.reason); act.why = res.reason; return; }
      if (res.cells) { act.n += res.cells; G.burst(a.x, surfaceAt(a.x, a.z) + 0.1, a.z, 4 + res.cells * 3, 0x5e8a3a, 1.4, 2.2, 0.07, 0.6); G.burst(a.x, surfaceAt(a.x, a.z) + 0.06, a.z, 4, 0x5a4230, 1.2, 1.6, 0.05, 0.5); }
    },
    release(a) {
      if (act.kind !== 'shovel') return;
      act.kind = '';
      if (act.tossed) return;
      if (act.skim) { if (act.n) { sayS('Skimmed the turf off ' + act.n + (act.n === 1 ? ' square' : ' squares') + '. Bare soil takes gravel, bark, sand or lawn seed.'); tip('skim'); } return; }
      if (isWater(a.x, a.z)) return sayS('That is water.');
      const res = cmd('landscape.dig', { x: a.x, z: a.z });
      if (!res.ok) return sayS(res.reason);
      const y = surfaceAt(a.x, a.z);
      G.burst(a.x, y + 0.12, a.z, 10, res.s === 'gravel' ? 0xa49d90 : 0x5a4230, 1.5, 2.4, 0.07, 0.6);
      if (res.turf) G.burst(a.x, y + 0.12, a.z, 6, 0x5e8a3a, 1.6, 2.6, 0.07, 0.7);
      G.cam.shake = Math.min(G.cam.shake + 0.06, 0.4);
      if (res.liner) sayS('You cut into the pond liner: the water ran out. The liner is back in your stock.', 5);
      setHeap(); tip('dug', res);
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
    const res = k === 'seed' ? cmd('landscape.seedLawn', { x: a.x, z: a.z, r: 0.42 }) : cmd('landscape.spread', { surface: k, x: a.x, z: a.z, r: 0.42, m3: 0.035 * step * Math.max(0.25, a.tip) });
    if (!res.ok) { if (act.why !== res.reason) say(res.reason, 4); act.why = res.reason; return; }
    act.n++;
    const hex = k === 'seed' ? 0xe8dca0 : matHex(k);
    G.burst(a.x, a.y + 0.55, a.z, 6, hex, 1.2, 0.3, k === 'seed' ? 0.025 : 0.05, 0.6);
  }
  // setting stones: click sets one; dragging lays a line along the drag at the stone's spacing
  function setStone(kind, x, z, yaw) {
    const at = stoneAt(kind, x, z);
    const res = cmd('landscape.place', { kind, x: at.below ? at.x : x, z: at.below ? at.z : z, yaw: at.yaw ?? yaw });
    if (!res.ok) { if (act.why !== res.reason) say(res.reason); act.why = res.reason; return false; }
    act.n++;
    G.burst(x, at.y + 0.05, z, 6, 0x8f887a, 1.0, 1.2, 0.04, 0.4);
    G.cam.shake = Math.min(G.cam.shake + (kind === 'boulder' ? 0.25 : 0.05), 0.4);
    if (res.stacked) tip('course', res);
    return true;
  }
  function stoneFrame(a, kind) {
    const th = THINGS[kind], d = Math.hypot(a.x - act.lx, a.z - act.lz);
    if (d < th.spacing) return;
    const yaw = Math.atan2(a.x - act.lx, a.z - act.lz) + (th.line === 'tight' ? Math.PI / 2 : 0);
    const n = Math.floor(d / th.spacing);
    for (let i = 1; i <= n; i++) {
      const x = act.lx + ((a.x - act.lx) * i * th.spacing) / d, z = act.lz + ((a.z - act.lz) * i * th.spacing) / d;
      setStone(kind, x, z, th.line === 'step' ? ghostYaw : yaw);
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
  const label = $('glabel');
  const I = (body) => '<svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="#f1ead6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  const ICONS = {
    hands: I('<path d="M12 22v-9a2 2 0 0 1 4 0v6M16 18v-8a2 2 0 0 1 4 0v8M20 18v-7a2 2 0 0 1 4 0v8M24 19v-4a2 2 0 0 1 4 0v9c0 6-3 10-9 10-4 0-6-2-8-5l-4-7c-1-2 1-4 3-2l2 3" fill="#e9b88f" stroke="#f6dcc0"/>'),
    shovel: I('<path d="M27 5l-9 17" stroke="#d8b585" stroke-width="2.6"/><path d="M24 4l6 3" stroke="#3a3a3a" stroke-width="3"/><path d="M15 20l7 4-3 9c-1 2-4 2-6 1s-3-3-2-5z" fill="#9aa4ab" stroke="#cfd6dc"/><path d="M6 34c4-3 9-3 14-1" stroke="#a3784e" stroke-width="2"/>'),
    rake: I('<path d="M29 5L15 27" stroke="#d8b585" stroke-width="2.6"/><path d="M7 25l14 9" stroke="#b9c2c9" stroke-width="2.6"/><path d="M8 26l-2 4M11 28l-2 4M14 30l-2 4M17 32l-2 4M20 34l-2 3" stroke="#b9c2c9" stroke-width="1.8"/>'),
    bucket: (hex) => I('<path d="M9 15h22l-3 19H12z" fill="#6e7b52" stroke="#d3dcb5"/><path d="M9 15c2-6 20-6 22 0" stroke="#d3dcb5"/><ellipse cx="20" cy="15" rx="10" ry="3" fill="' + hex + '" stroke="none"/>'),
    stone: (hex, w, h) => I('<path d="M' + (20 - w) + ' ' + (28) + 'q2-' + h + ' ' + w + '-' + h + 't' + w + ' ' + h + 'z" fill="' + hex + '" stroke="#efe6d2"/><path d="M5 30h30" stroke="#a3784e" stroke-width="2"/>'),
    wall: I('<path d="M6 32h12v-7H6zM20 32h14v-7H20zM10 25h14v-7H10zM26 25h8v-7h-8z" fill="#8f887a" stroke="#efe6d2" stroke-width="1.6"/>'),
    pot: (hex) => I('<path d="M13 24h14l-2 11H15z" fill="#9a5a3a" stroke="#f0c8a8"/><circle cx="20" cy="15" r="8" fill="' + hex + '" stroke="#e8f0d8"/><path d="M20 23v-6" stroke="#6f9a3a"/>'),
    barrow: I('<path d="M6 14h20l-4 10H11z" fill="#2f6e8e" stroke="#cfe4ee"/><circle cx="25" cy="29" r="4" fill="#222" stroke="#ddd"/><path d="M8 24l-3 8M21 24l4 2M26 14l9-4" stroke="#d8b585" stroke-width="2"/>'),
    can: I('<path d="M10 16h16v16H10z" fill="#5f8a6a" stroke="#d6eadb"/><path d="M26 19l9-7" stroke="#d6eadb" stroke-width="3"/><path d="M12 16c0-6 12-6 12 0" stroke="#d6eadb"/>'),
    hose: I('<circle cx="20" cy="20" r="11" stroke="#58b064" stroke-width="3.2"/><circle cx="20" cy="20" r="6" stroke="#58b064" stroke-width="3"/><path d="M31 20h5" stroke="#58b064" stroke-width="3"/>'),
    liner: I('<rect x="8" y="10" width="24" height="8" rx="4" fill="#2a2c2d" stroke="#bbb"/><path d="M10 18c0 8 20 8 20 0" fill="#3a6a8a" stroke="#bfe0f0"/>'),
    timber: I('<path d="M5 24h30v6H5zM8 18h24v6H8z" fill="#8d7152" stroke="#efe6d2" stroke-width="1.6"/>'),
    light: I('<path d="M20 16v18" stroke="#888" stroke-width="2.4"/><path d="M14 12h12l-2 5h-8z" fill="#ffd98a" stroke="#efe6d2"/><circle cx="20" cy="9" r="2" fill="#fff3c0" stroke="none"/>'),
    store: I('<path d="M5 16l3-8h24l3 8z" fill="#7e9b5a" stroke="#e8f0d8"/><path d="M7 16v17h26V16" stroke="#efe6d2"/><path d="M16 33v-9h8v9" fill="#8a6238" stroke="#efe6d2"/>'),
  };
  const PLANT_HEX = { lavender: '#8b6fc4', coneflower: '#e8b52a', grass: '#b7a26a', boxwood: '#3d6a31', hydrangea: '#f1f0e2', rose: '#c4243a', maple: '#9b2226', blueberry: '#4a5a9c', apple: '#c0392b', iris: '#f2d02a' };
  const LAYER_ITEM = { gravel: 'gravel', riverrock: 'river_rock', bark: 'bark_mulch', sand: 'sand', seed: 'grass_seed' };
  const amount = (k) => { const id = LAYER_ITEM[k], u = ITEMS[id].unit, v = have(id); return u === 'm3' ? Math.round(v * 1000) + ' L' : u === 'kg' ? (v < 1 ? Math.round(v * 1000) + ' g' : v.toFixed(1) + ' kg') : Math.round(v) + ' L'; };
  function slotList() {
    const out = [{ id: 'hands', name: 'Hands', icon: ICONS.hands, title: 'Hands: pick up stones and plants' }];
    out.push({ id: 'shovel', name: 'Shovel', icon: ICONS.shovel, item: ITEM.shovel, dim: !owns('shovel') && !owns('spade'), badge: loaded() ? litres(L().carry.m3) + ' L' : null, title: 'Shovel: dig, carry and toss earth; drag to skim turf' });
    out.push({ id: 'rake', name: 'Rake', icon: ICONS.rake, item: ITEM.rake, dim: !owns('rake'), title: 'Rake: level loose ground' });
    if (owns('wheelbarrow')) out.push({ id: 'barrow', name: 'Barrow', icon: ICONS.barrow, item: ITEM.barrow, badge: L().barrow.m3 > 1e-6 ? litres(L().barrow.m3) + ' L' : null, title: 'Wheelbarrow: click to shovel a scoop in, drag down to tip it out' });
    const GV = window.__gardenView;
    if (GV && GV.can && owns('watering_can')) out.push({ id: 'can', name: 'Can', icon: ICONS.can, item: GV.can.item, badge: Math.round((G.sim.state.sys.garden.can.litres || 0) * 10) / 10 + ' L', title: 'Watering can: water new plants in; fill it at the pump or the stream' });
    if (owns('garden_hose')) out.push({ id: 'hose', name: 'Hose', icon: ICONS.hose, item: ITEM.hose, title: 'Hose: click a lined pond to fill it' });
    if (have('pond_liner') >= 0.05) out.push({ id: 'liner', name: 'Liner', icon: ICONS.liner, item: ITEM.liner, badge: have('pond_liner').toFixed(1) + ' m²', title: 'Pond liner: click a dug hole to line it' });
    for (const [k, nm, hex] of [['gravel', 'Gravel', '#a49d90'], ['riverrock', 'River rock', '#8c8478'], ['bark', 'Bark', '#6a412c'], ['sand', 'Sand', '#d8c79a'], ['seed', 'Lawn seed', '#d9cf9a']])
      if (have(LAYER_ITEM[k]) > 1e-6) out.push({ id: k, name: nm, icon: ICONS.bucket(hex), item: ITEM[k], badge: amount(k) });
    for (const k of Object.keys(THINGS)) {
      const th = THINGS[k], n = have(th.item) / th.qty;
      if (n >= 1 - 1e-6) out.push({ id: k, name: th.name.replace('Brick ', ''), icon: k === 'wallstone' ? ICONS.wall : k === 'timber' ? ICONS.timber : k === 'pathlight' ? ICONS.light : ICONS.stone(k === 'paver' ? '#a65a3f' : k === 'boulder' ? '#7d7a72' : '#b9a988', k === 'boulder' ? 12 : 10, k === 'boulder' ? 14 : k === 'flagstone' ? 3 : 5), item: ITEM[k], badge: Math.floor(n + 1e-6) });
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
    if (on) setSlots(); renderStore();
    return r.ok;
  }
  const STORE = [
    ['gravel', 0.25, 'Gravel', '250 L: a path 3 m long'], ['bark_mulch', 200, 'Bark mulch', '200 L: 3 m2 of border'], ['sand', 0.1, 'Sand', '100 L: a bed for stones'],
    ['grass_seed', 1, 'Lawn seed', '1 kg sows 25 m2'], ['flagstone_40', 2, 'Flagstones', '10 stepping stones'], ['paver_brick', 50, 'Brick pavers', '50 bricks: 10 m of edging'],
    ['stone', 40, 'Wall stones', '40 fieldstones: a low wall'], ['boulder', 1, 'Boulder', 'A feature rock'],
    ['river_rock', 0.25, 'River rock', '250 L: a dry creek bed 3 m long'], ['pond_liner', 6, 'Pond liner', '6 m2: lines a pond about 1.5 m across'],
    ['landscape_timber', 10, 'Timbers', '10 of 1.2 m: a raised bed, two courses high'], ['path_light', 6, 'Path lights', '6 solar lights for a path'],
  ];
  function renderStore() {
    let h = '';
    const sc = L().scale || 1;
    h += '<button type="button" class="gseed" data-scale="1"><b>Earth per scoop</b><span>' + [1, 2, 4].map((v) => (v === sc ? '<b style="display:inline;font-size:14px">' + v + '×</b>' : v + '×')).join(' · ') + '</span><span>' + litres(SCOOP_M3 * sc) + ' L a scoop. Click to change</span></button>';
    for (const id of ['trowel', 'rake', 'wheelbarrow', 'garden_hose', 'watering_can']) if (!owns(id)) h += '<button type="button" class="gseed" data-buy="' + id + '" data-qty="1"><b>' + esc(ITEMS[id].name) + '</b><span>' + esc(ITEMS[id].blurb || '') + '</span><span>Buy for ' + money(ITEMS[id].priceUsd) + '</span></button>';
    for (const [id, q, nm, what] of STORE) h += '<button type="button" class="gseed" data-buy="' + id + '" data-qty="' + q + '"><b>' + nm + '</b><span>' + esc(what) + '</span><span>' + money(ITEMS[id].priceUsd * q) + '</span></button>';
    for (const k of Object.keys(PLANTS)) { const p = PLANTS[k], it = ITEMS[p.item]; h += '<button type="button" class="gseed" data-buy="' + p.item + '" data-qty="1"><b>' + esc(p.name) + '<i style="background:' + PLANT_HEX[k] + '"></i></b><span>' + esc(p.blurb) + '</span><span>Hole ' + Math.round(p.holeM * 100) + ' cm · ' + money(it.priceUsd) + (have(p.item) >= 1 ? ' · have ' + Math.floor(have(p.item)) : '') + '</span></button>'; }
    storeEl.innerHTML = h;
  }
  storeEl.addEventListener('click', (e) => {
    const b = e.target.closest('.gseed'); if (!b) return;
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
      else if (id === 'shovel') h = loaded() ? '<b>' + litres(L().carry.m3) + ' L</b> of ' + (L().carry.s === 'soil' ? 'earth' : esc(SURFACES[L().carry.s] ? SURFACES[L().carry.s].name.toLowerCase() : L().carry.s)) + ' on the shovel: <b>click</b> where to toss it.' : '<b>Click</b> to dig a scoop. <b>Drag</b> along the grass to skim the turf off.';
      else if (id === 'barrow') h = L().barrow.m3 > 1e-6 ? '<b>' + litres(L().barrow.m3) + ' L</b> in the barrow. <b>Click</b> to shovel in more, <b>drag down</b> to tip it all out.' : '<b>Click</b> to shovel a scoop into the barrow. When it is full, walk it over and <b>drag down</b> to tip it out.';
      else if (id === 'can') h = '<b>Hold and drag down</b> to pour over new plants: water them in, and keep them moist for three weeks while they root. Fill the can at the pump or the stream.';
      else if (id === 'hose') h = '<b>Click</b> a lined pond to run the hose into it, click again to stop.';
      else if (id === 'liner') h = '<b>Click</b> a dug hole to lay one sheet of liner over all of it (' + have('pond_liner').toFixed(1) + ' m² left). Dig the pond first: a shelf 20 to 30 cm deep round the edge, deeper in the middle.';
      else if (id === 'rake') h = owns('rake') ? '<b>Drag</b> over loose ground to level it.' : 'You need a rake. <button type="button" class="go" data-buy="rake">Buy ' + money(ITEMS.rake.priceUsd) + '</button>';
      else if (id === 'riverrock') h = '<b>Hold and sweep</b> river rock along a dug channel for a dry creek bed (' + amount(id) + ' left). Lay it over pond liner for a beach.';
      else if (LAYER_ITEM[id]) h = id === 'seed' ? '<b>Hold and sweep</b> over bare soil to sow lawn. It knits into turf in about three weeks.' : '<b>Hold and sweep</b> to lay ' + id + ' (' + amount(id) + ' left). Drag down to pour faster. It goes on bare soil: skim the turf first.';
      else if (THINGS[id]) h = '<b>Click</b> to set a ' + THINGS[id].name.toLowerCase() + ', <b>drag</b> to lay a line. <b>R</b> turns it.' + (THINGS[id].stack ? ' Set one on another for the next course.' : '');
      else if (id.startsWith('plant:')) { const p = PLANTS[id.slice(6)]; h = 'Dig a hole about <b>' + Math.round(p.holeM * 100) + ' cm</b> deep with the shovel, then <b>click</b> it with the ' + esc(p.name.toLowerCase()) + '.'; }
      else h = '<b>Press</b> on a stone or a plant and <b>lift</b> (drag up) to pick it up.';
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
    if (what === 'dug') sayS('A scoop of ' + (res.s === 'soil' ? 'earth' : res.s) + ' (' + litres(res.m3) + ' L). Click anywhere to toss it: a heap, a hill, a bank.', 5);
    else if (what === 'tossed') sayS('Loose earth runs down until it holds. Rake it level, or keep heaping.', 5);
    else if (what === 'skim') sayS('Skimmed. Bare soil takes gravel, bark, sand or lawn seed; dig deeper for a sunken path.', 5);
    else if (what === 'course') sayS('Course ' + res.course + '. Stagger the joints and lean the wall back a little into the bank behind it.', 5);
  }

  /* ================= press, frame, release ================= */
  function press(a) {
    const id = held();
    act.kind = id; act.n = 0; act.lx = a.x; act.lz = a.z; act.acc = 0.16; act.why = ''; act.grab = null;
    if (id === 'shovel') return shovel.press(a);
    if (id === 'can') { const GV = window.__gardenView; if (GV) { GV.bindSay(say); GV.can.press(a); } return; }
    if (id === 'barrow') { act.tipped = false; return; }
    if (id === 'liner') {
      // one sheet over the whole hole under the hand
      const res = cmd('landscape.line', { x: a.x, z: a.z, whole: true });
      act.kind = '';
      if (!res.ok) return say(res.reason, 4);
      G.burst(a.x, surfaceAt(a.x, a.z) + 0.1, a.z, 14, 0x2a2c2d, 1.4, 0.8, 0.06, 0.5);
      return say('Lined the hole: ' + res.cells + (res.cells === 1 ? ' square' : ' squares') + '. Hide the edge under stones, then run the hose into it.', 5);
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
    if (id === 'hands') { const t = nearestThing(a.x, a.z); if (t) act.grab = t; }
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
    else if (k === 'can') { const GV = window.__gardenView; if (GV) GV.can.frame(a, dt); }
    else if (k === 'barrow') {
      if (!act.tipped && a.tip > 0.45) {
        act.tipped = true;
        const res = cmd('landscape.tip', { x: a.x, z: a.z });
        if (!res.ok) return say(res.reason);
        const y = surfaceAt(a.x, a.z);
        G.burst(a.x, y + 0.3, a.z, 24, matHex(res.s), 1.8, 1.4, 0.07, 0.7); G.cam.shake = Math.min(G.cam.shake + 0.2, 0.4);
        setHeap(); say('Tipped out ' + litres(res.m3) + ' L.');
      }
    }

    else if (k === 'rake') rakeFrame(a);
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
    if (k === 'hands' && act.grab) say('Lift it: drag up.');
    act.kind = ''; act.grab = null;
    updateHint(true);
  }

  /* ================= the name tag: what the aimed ground is ================= */
  let tagSig = '';
  function updateTag(a) {
    if (!on || !a.valid) { if (!label.hidden) label.hidden = true; tagSig = ''; return; }
    const [gx, gz] = sqOf(a.x, a.z), q = EW.square(grid(), gx, gz), id = held();
    let t = '';
    if (q) {
      const cm = Math.round(q[0] * 100);
      t = (SURFACES[q[1]] ? SURFACES[q[1]].name : q[1] === '' ? 'Turf' : q[1]) + (cm <= -2 ? ' · hole ' + -cm + ' cm' : cm >= 2 ? ' · raised ' + cm + ' cm' : '');
      if (q[2] > 0.005) t += ' · ' + Math.round(q[2] * 100) + ' cm deep';
    }
    // a plant under the hand: its name and how it is doing
    const near = Object.values(L().plants).find((pl) => Math.hypot(pl.x - a.x, pl.z - a.z) < 0.35);
    if (near && !id.startsWith('plant:')) {
      const z = RD.plantSize(G.sim.state, near.id, G.sim.state.lifeT), pk = PLANTS[near.k];
      t = pk.name + ': ' + (pk.wet ? 'growing in the shallows' : z.wilt ? 'wilting, water it' : z.thirsty ? 'thirsty' : !z.rooted ? 'rooting in, keep it moist' : z.k > 0.85 ? 'full grown' : 'growing') + ' · ' + Math.round(z.h * 100) + ' cm';
    }
    const pd = L().liner[gx + ',' + gz] && RD.pondsOf(G.sim.state).find((p) => p.cells.some(([x, z]) => x === gx && z === gz));
    if (pd) t = 'Pond · ' + litres(pd.m3) + ' of ' + litres(pd.cap) + ' L' + (pd.m3 > 0 ? ' · ' + Math.max(0, Math.round((pd.level - (q ? q[0] : 0)) * 100)) + ' cm deep here' : ' · empty') + (pd.hose ? ' · filling' : '');
    if (id.startsWith('plant:') && PLANTS[id.slice(6)].wet) { t = pd && pd.m3 > 0 ? 'Water ' + Math.max(0, Math.round((pd.level - (q ? q[0] : 0)) * 100)) + ' cm deep: 5 to 25 is right' : 'An iris goes in the shallows of a filled pond'; }
    else if (id.startsWith('plant:')) {
      const p = PLANTS[id.slice(6)], d = q ? Math.max(0, -q[0]) : 0;
      t = d >= p.holeM * 0.8 ? 'Deep enough: click to plant' : 'Hole ' + Math.round(d * 100) + ' of ' + Math.round(p.holeM * 100) + ' cm';
    }
    if (!t) { if (!label.hidden) label.hidden = true; tagSig = ''; return; }
    if (t !== tagSig) { tagSig = t; label.textContent = t; label.classList.toggle('warn', /^Hole \d/.test(t)); }
    label.hidden = false;
    const s = H.toScreen(a.x, a.y + 0.25, a.z, {});
    label.style.transform = 'translate(' + Math.round(s.x + 18) + 'px,' + Math.round(s.y - 28) + 'px)';
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
    H.open({ bar: toolsEl, reach: 2.0, camDist: 9, pace: 0.55, tipPx: 90, liftPx: 70, slots: mySlots, held: lastHeld, onHold, press, frame, release });
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
  let last = performance.now(), slow = 0;
  function tick(t) {
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    const want = G.player.tool === 'yard';
    if (want !== on) { if (want) enter(); else leave(); }
    if (on) updateTag(H.aim);
    if (hoseMeshes.size) hoseSpray();
    slow += dt;
    if (slow > 0.25 || dirty) {
      slow = 0; dirty = false;
      refreshGround(false);
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
    get on() { return on; }, hold: (id) => H.hold(id), refresh: () => { dirty = true; refreshGround(true); layoutStones(); layoutPlants(true); }, tiles: () => tileViews.size,
  };
})();
