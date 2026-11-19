/* Garden view: gardening with your hands (key 5). You hold a hoe, a watering can, a seed packet or nothing, chosen
   from a small hotbar, and work the ground within arm's reach with one gesture per job: pull the hoe through the
   soil, tip the can, drop seed along a row, pull a root up. Also the plants and beds themselves, the name tag, the
   inspector card (F), the almanac (N) and the "Grow your first salad" cards.
   Draws the simulation's garden (sim.state.sys.garden) and owns no truth of its own: every action is a garden.*
   command. Reaches the game only through window.__game and the generic hands of src/engine/hands.js (window.__hands).
   Cost: nothing per frame unless something moves on screen; soil colours and plant instances are rebuilt only
   when a cell or plant changes visibly (checked four times a second, cheaply). */
(() => {
  const G = window.__game, H = window.__hands;
  if (!G || !H || !G.sim || !G.sim.handlers.has('garden.till')) return;
  const T = G.THREE, $ = (id) => document.getElementById(id), canvas = $('view');
  const bar = $('gbar'), hint = bar.querySelector('.ghint'), toolsEl = bar.querySelector('.gtools'), seedsEl = bar.querySelector('.gseeds');
  const label = $('glabel'), fxEl = $('gfx'), card = $('gcard'), alm = $('galm'), tip = $('gtip');
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), lerp = (a, b, t) => a + (b - a) * t;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const CELL = 0.3, DAY = 86400;
  const S = () => G.sim.state.sys.garden;
  const stock = () => G.sim.state.sys.stock;
  const ITEMS = G.stock.ITEMS;
  const cmd = (name, p) => { const r = G.sim.commandNow(name, p); G.markStockDirty && G.markStockDirty(); dirty = true; return r; };
  const owns = (id) => stock().tools.includes(id);
  const have = (id) => stock().items[id] || 0;
  const life = () => (G.sim.lifeScale ? G.sim.lifeScale() : 1);
  // the ground as shaped by hand (src/landscape-view.js): holes, hills and hilled rows lift or sink the bed with it
  const LS = () => window.__landscape;
  const rel = (x, z) => (LS() ? LS().relief(x, z) : 0);
  const gy = (x, z) => G.heightAt(x, z) + rel(x, z);

  // crop facts the view needs to draw and label them (the growing figures stay in the simulation)
  const CROPS = {
    radish: { name: 'Radish', plural: 'radishes', seed: 'seed_radish', col: 0xc8384a, spacing: 0.075, per: 4, gesture: 'pull', count: 16 },
    lettuce: { name: 'Lettuce', plural: 'lettuces', seed: 'seed_lettuce', col: 0x9bd05a, spacing: 0.15, per: 4, gesture: 'cut', count: 4 },
    peas: { name: 'Peas', plural: 'peas', seed: 'seed_peas', col: 0x6fb04a, spacing: 0.1, per: 3, gesture: 'pick', count: 9 },
    potato: { name: 'Potato', plural: 'potatoes', seed: 'seed_potato', col: 0xc9a46a, spacing: 0.3, per: 1, gesture: 'dig', count: 1 },
    tomato: { name: 'Tomato', plural: 'tomatoes', seed: 'seedling_tomato', col: 0xd8402c, spacing: 0.6, per: 1, gesture: 'pick', count: 1 },
    bean: { name: 'Bush bean', plural: 'beans', seed: 'seed_bean', col: 0x5f9e3c, spacing: 0.1, per: 3, gesture: 'pick', count: 9 },
    carrot: { name: 'Carrot', plural: 'carrots', seed: 'seed_carrot', col: 0xe8822e, spacing: 0.075, per: 4, gesture: 'pull', count: 16 },
    squash: { name: 'Winter squash', plural: 'squash', seed: 'seed_squash', col: 0xd9a35a, spacing: 0.9, per: 1, gesture: 'cut', count: 1 },
    kale: { name: 'Kale', plural: 'kale', seed: 'seed_kale', col: 0x3f6b4e, spacing: 0.3, per: 1, gesture: 'pick', count: 1 },
    garlic: { name: 'Garlic', plural: 'garlic', seed: 'seed_garlic', col: 0xe9e2cf, spacing: 0.15, per: 4, gesture: 'pull', count: 4 },
    corn: { name: 'Sweet corn', plural: 'corn', seed: 'seed_corn', col: 0xe8cf57, spacing: 0.3, per: 1, gesture: 'twist', count: 1 },
    wheat: { name: 'Wheat', plural: 'wheat', seed: 'seed_wheat', col: 0xd8b860, spacing: 0.06, per: 9, gesture: 'reap', count: 25 },
  };
  const CROP_IDS = Object.keys(CROPS);
  // sown in a hole rather than a drill, and worth hilling (as in src/sim/content/crops.js: deep, hill)
  const DEEP = { potato: 1, tomato: 1, squash: 1, garlic: 1 }, HILL = { potato: 1 };
  const spanOf = (id) => (CROPS[id].spacing > CELL + 1e-9 ? Math.round(CROPS[id].spacing / CELL) : 1);
  const read = G.garden;   // the garden's read-outs (almanac, plantInfo, cellInfo...), from the simulation
  if (!read) return;


  /* ================= icons (inline SVG, drawn for this hotbar) ================= */
  const I = (body) => '<svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="#f1ead6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  const ICONS = {
    hands: I('<path d="M12 22v-9a2 2 0 0 1 4 0v6M16 18v-8a2 2 0 0 1 4 0v8M20 18v-7a2 2 0 0 1 4 0v8M24 19v-4a2 2 0 0 1 4 0v9c0 6-3 10-9 10-4 0-6-2-8-5l-4-7c-1-2 1-4 3-2l2 3" fill="#e9b88f" stroke="#f6dcc0"/>'),
    water: I('<path d="M8 17h16v13a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z" fill="#5f8fb0" stroke="#bfe2f7"/><path d="M24 20l9-7" stroke="#bfe2f7"/><path d="M33 13l2-2" stroke="#bfe2f7" stroke-width="3"/><path d="M12 17c0-4 2-6 4-6s4 2 4 6" stroke="#bfe2f7"/><path d="M35 18v3M32 22v3M36 24v3" stroke="#8fd0f2" stroke-width="1.8"/>'),
    hoe: I('<path d="M28 6L14 30" stroke="#d8b585" stroke-width="2.6"/><path d="M10 27l7 5-3 3-7-4z" fill="#b9c2c9" stroke="#cfd6dc"/><path d="M26 30c2-3 5-4 8-3M22 34c2-2 4-3 7-3" stroke="#8cc35a" stroke-width="1.6"/>'),
    mulch: I('<path d="M6 30c8-4 20-4 28 0" stroke="#e8c97a" stroke-width="3"/><path d="M8 27l6-5M14 28l5-7M20 27l6-6M26 28l5-5M11 24l-3-4M23 24l2-5" stroke="#e8c97a" stroke-width="1.6"/>'),
    compost: I('<path d="M8 32l4-14h16l4 14z" fill="#5a3d26" stroke="#c99a6a"/><path d="M12 18c2-4 14-4 16 0" stroke="#c99a6a"/><path d="M15 26h2M22 24h2M19 29h2" stroke="#9b7a52" stroke-width="2"/><path d="M27 12c2-2 5-2 6 0" stroke="#8cc35a" stroke-width="1.6"/>'),
    box: I('<path d="M6 16h28v16H6z" fill="#8a6238" stroke="#e8c79a"/><path d="M6 16l4-6h20l4 6" stroke="#e8c79a"/><path d="M13 10v-3h5v3M22 10v-4h5v4" fill="#f2e8c8" stroke="#f2e8c8" stroke-width="1.4"/><path d="M16 24h8" stroke="#e8c79a"/>'),
    packet: (hex) => I('<path d="M11 6h18v28H11z" fill="#f2e8c8" stroke="#fff6dc"/><path d="M11 12h18" stroke="#c9b98a" stroke-width="1.6"/><circle cx="20" cy="22" r="6" fill="' + hex + '" stroke="none"/><path d="M20 15c0-3 2-4 4-4" stroke="#6f9a3a" stroke-width="1.8"/>'),
  };
  ICONS.trowel = I('<path d="M27 7l-6 8" stroke="#d8b585" stroke-width="3.2"/><path d="M22 14l-8 10c-2 3-3 7-2 10 3 1 7-1 9-3l6-10z" fill="#b9c2c9" stroke="#cfd6dc"/><path d="M7 34h12" stroke="#a3784e" stroke-width="2" stroke-dasharray="2 3"/>');
  ICONS.shovel = I('<path d="M27 5l-9 17" stroke="#d8b585" stroke-width="2.6"/><path d="M24 4l6 3" stroke="#3a3a3a" stroke-width="3"/><path d="M15 20l7 4-3 9c-1 2-4 2-6 1s-3-3-2-5z" fill="#9aa4ab" stroke="#cfd6dc"/><path d="M6 34c4-3 9-3 14-1" stroke="#a3784e" stroke-width="2"/>');
  const hexOf = (n) => '#' + n.toString(16).padStart(6, '0');

  /* ================= state of the view ================= */
  let on = false, crop = 'radish', dirty = true, hintSig = '';
  const flash = { msg: '', until: 0 };
  const snap = (v) => Math.round(v / CELL) * CELL;
  function cellAt(x, z) {
    for (const b of Object.values(S().field.groups)) {
      const ix = Math.floor((x - b.x0) / CELL), iz = Math.floor((z - b.z0) / CELL);
      if (ix >= 0 && iz >= 0 && ix < b.nx && iz < b.nz) return { bed: b, i: iz * b.nx + ix, ix, iz };
    }
    return null;
  }
  const toScreen = H.toScreen;
  const tillOf = (c) => (c.till === undefined ? 1 : c.till);
  const tillAt = (b, ix, iz) => (ix < 0 || iz < 0 || ix >= b.nx || iz >= b.nz ? 0 : tillOf(b.cells[iz * b.nx + ix]));

  /* ================= the soil: one mesh per bed. Ground is drawn where it has been worked: rough clods after the
     first stroke of the hoe, fine furrowed tilth once worked through; coloured by moisture, mulch and weeds ================= */
  const soilMat = new T.MeshLambertMaterial({ vertexColors: true });
  const coverMat = new T.MeshLambertMaterial({ color: 0xf4f2ea, transparent: true, opacity: 0.45, side: T.DoubleSide, depthWrite: false });
  const bedViews = new Map();   // bed id -> { group, soil, geo, pos, col, sig, till, b, dim, cover }
  const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const SOIL_DRY = new T.Color(0x8c7860), SOIL_WET = new T.Color(0x3a2c22), STRAW = new T.Color(0xcdb176), WEEDY = new T.Color(0x56703a), SOD = new T.Color(0x5d7a36), _c = new T.Color();
  const RAISE = 0.05;
  const SUB = 3;   // each 30 cm cell is drawn as 3 x 3 little quads (10 cm, as fine as the shaped ground), so the tilth has clods and furrows and follows a dug shape
  const dimOf = (b) => b.x0 + ':' + b.z0 + ':' + b.nx + ':' + b.nz;
  function buildBed(b) {
    const g = new T.Group();
    const n = b.nx * b.nz, per = SUB * SUB * 6, pos = new Float32Array(n * per * 3), col = new Float32Array(n * per * 3);
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    const soil = new T.Mesh(geo, soilMat);
    soil.receiveShadow = true; soil.frustumCulled = false;
    g.add(soil);
    G.scene.add(g);
    const v = { group: g, soil, geo, pos, col, sig: new Float32Array(n).fill(-1), till: new Float32Array(n).fill(-1), b, dim: dimOf(b), cover: null, per };
    // a fixed speckle per vertex: lighter grains and darker crumbs
    v.noise = new Float32Array(n * per);
    for (let i = 0; i < v.noise.length; i++) { const r = hash(i, b.nx * 31 + b.nz); v.noise[i] = r < 0.08 ? 1.25 : r > 0.9 ? 0.72 : 0.9 + 0.16 * hash(i, 7); }
    bedViews.set(b.id, v);
    return v;
  }
  // the shape of the worked ground: sod is left alone, a first stroke leaves rough clods, worked soil is furrowed
  // how far a sowing opening sinks the soil at a lattice point: a hole at a square's centre, a drill along its middle line
  function openDepth(b, x, z) {
    let d = 0;
    for (const ox of [-1e-3, 1e-3]) for (const oz of [-1e-3, 1e-3]) {
      const ix = Math.floor((x + ox - b.x0) / CELL), iz = Math.floor((z + oz - b.z0) / CELL);
      if (ix < 0 || iz < 0 || ix >= b.nx || iz >= b.nz) continue;
      const c = b.cells[iz * b.nx + ix];
      if (!c.open) continue;
      const cx = b.x0 + (ix + 0.5) * CELL, cz = b.z0 + (iz + 0.5) * CELL;
      if (c.open === 2 && Math.abs(x - cx) < 1e-3 && Math.abs(z - cz) < 1e-3) d = Math.max(d, 0.075);
      else if (c.open === 1 && Math.abs(z - cz) < 1e-3) d = Math.max(d, 0.04);
      else if (c.open === 3 && Math.abs(x - cx) < 1e-3) d = Math.max(d, 0.04);
    }
    return d;
  }
  function shapeBed(v) {
    const b = v.b, pos = v.pos, st = CELL / SUB, along = b.nx >= b.nz, e = 0.07;
    const tp = (x, z) => tillAt(b, Math.floor((x - b.x0) / CELL + 1e-6), Math.floor((z - b.z0) / CELL + 1e-6));
    if (!v.dip || v.dip.length !== pos.length / 3) v.dip = new Float32Array(pos.length / 3);
    let k = 0;
    for (let iz = 0; iz < b.nz; iz++) for (let ix = 0; ix < b.nx; ix++) {
      const t = tillAt(b, ix, iz);
      for (let sz = 0; sz < SUB; sz++) for (let sx = 0; sx < SUB; sx++) {
        const x0 = b.x0 + ix * CELL + sx * st, z0 = b.z0 + iz * CELL + sz * st;
        for (let q = 0; q < 6; q++) {
          const x = x0 + (q === 2 || q === 3 || q === 5 ? st : 0), z = z0 + (q === 1 || q === 4 || q === 5 ? st : 0);
          let y = gy(x, z);
          const dp = t >= 1 ? openDepth(b, x, z) : 0;
          v.dip[k / 3] = dp;
          if (t <= 0) y -= 0.3;
          else if (tp(x - e, z - e) > 0 && tp(x + e, z - e) > 0 && tp(x - e, z + e) > 0 && tp(x + e, z + e) > 0) {
            const across = along ? z - b.z0 : x - b.x0, r = hash(Math.round(x * 60), Math.round(z * 60)) - 0.5;
            // on a shaped slope (a hill, the side of a hollow) the bed's own raise and furrows ease off: the shape is the bed
            const sl = Math.hypot(rel(x + 0.1, z) - rel(x - 0.1, z), rel(x, z + 0.1) - rel(x, z - 0.1)) / 0.2, fl = clamp(1 - sl * 2.5, 0.25, 1);
            y += t >= 1 ? (RAISE + 0.02 * Math.cos((across / CELL) * Math.PI * 2)) * fl + 0.012 + r * 0.016 - dp : 0.025 + 0.02 * t + r * 0.07 * fl;
          } else y += 0.006;
          pos[k++] = x; pos[k++] = y; pos[k++] = z;
        }
      }
    }
    v.geo.attributes.position.needsUpdate = true;
    v.geo.computeVertexNormals();
  }
  function paintBed(v) {
    const b = S().field.groups[v.b.id] || v.b, info = read.cellInfo;
    let changed = false, reshaped = false;
    for (let i = 0; i < b.cells.length; i++) { const t = tillOf(b.cells[i]) + (b.cells[i].open || 0) * 10; if (v.till[i] !== t) { v.till[i] = t; reshaped = true; v.sig[i] = -1; } }
    const lr = LS() ? LS().rev : 0;
    if (v.lrev !== lr) { v.lrev = lr; reshaped = true; }
    if (reshaped) { shapeBed(v); hideGrass(true); v.sig.fill(-1); }
    for (let i = 0; i < b.cells.length; i++) {
      const till = tillOf(b.cells[i]);
      if (till <= 0) continue;
      const ci = info(G.sim.state, b.id, i);
      const wet = clamp(ci.water, 0, 1), s = Math.round(wet * 40) + Math.round(ci.mulch * 10) * 64 + Math.round(ci.weed * 10) * 1024;
      if (v.sig[i] === s) continue;
      v.sig[i] = s; changed = true;
      _c.copy(SOIL_DRY).lerp(SOIL_WET, Math.pow(wet, 0.8) * (till < 1 ? 0.55 : 1)).lerp(STRAW, ci.mulch * 0.85).lerp(WEEDY, ci.weed * 0.35);
      for (let k = 0; k < v.per; k++) {
        const o = i * v.per + k, n = v.noise[o];
        if (till < 1 && hash(o, 91) < (1 - till) * 0.75) { v.col[o * 3] = SOD.r * n; v.col[o * 3 + 1] = SOD.g * n; v.col[o * 3 + 2] = SOD.b * n; }   // turned sod: grass still showing between the clods
        else { const dk = v.dip ? 1 - v.dip[o] * 6 : 1; v.col[o * 3] = _c.r * n * dk; v.col[o * 3 + 1] = _c.g * n * dk; v.col[o * 3 + 2] = _c.b * n * dk; }   // an open drill or hole: dark, damp soil
      }
    }
    if (changed) v.geo.attributes.color.needsUpdate = true;
    // a row cover is a long tunnel of white fleece over hoops
    if (b.cover && !v.cover) {
      const W = b.nx * CELL, D = b.nz * CELL, along = W >= D;
      const geo = new T.CylinderGeometry(0.5, 0.5, 1, 14, 1, true, 0, Math.PI);
      const m = new T.Mesh(geo, coverMat);
      const len = along ? W : D, wide = along ? D : W;
      m.scale.set(wide * 0.55, len, Math.min(0.45, wide * 0.5));
      const y = gy(b.x0 + W / 2, b.z0 + D / 2) + RAISE;
      m.position.set(b.x0 + W / 2, y, b.z0 + D / 2);
      // a half-cylinder standing on the bed: rotate so its open side faces down
      if (along) { m.rotation.set(Math.PI / 2, 0, Math.PI / 2); } else { m.rotation.set(Math.PI / 2, Math.PI / 2, Math.PI / 2); }
      v.group.add(m); v.cover = m;
    } else if (!b.cover && v.cover) { v.group.remove(v.cover); v.cover.geometry.dispose(); v.cover = null; }
  }
  function dropBed(id) {
    const v = bedViews.get(id);
    if (!v) return;
    G.scene.remove(v.group);
    v.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    bedViews.delete(id);
  }

  /* ---- grass on worked ground: the engine's tufts are hidden there (re-applied when a chunk redraws) ---- */
  const grassSeen = new WeakMap();
  const ZERO = new T.Matrix4().makeScale(0, 0, 0);
  function hideGrass(force) {
    const beds = Object.values(S().field.groups);
    const chunks = G.world && G.world.chunks;
    if (!chunks || !beds.length) return;
    const CS = G.chunkSize || 32;
    for (const c of chunks.values()) {
      let near = false;
      for (const b of beds) if (b.x0 < c.ox + CS * 2 && b.x0 + b.nx * CELL > c.ox - CS && b.z0 < c.oz + CS * 2 && b.z0 + b.nz * CELL > c.oz - CS) { near = true; break; }
      if (!near) continue;
      for (const [mesh, list] of [[c.grassMesh, c.grass], [c.flowerMesh, c.flowers]]) {
        if (!mesh || !list) continue;
        const ver = mesh.instanceMatrix.version;
        if (!force && grassSeen.get(mesh) === ver) continue;
        let n = 0;
        list.forEach((g, i) => {
          const x = c.ox + g.lx, z = c.oz + g.lz;
          for (const b of beds) {
            if (x < b.x0 - 0.1 || x > b.x0 + b.nx * CELL + 0.1 || z < b.z0 - 0.1 || z > b.z0 + b.nz * CELL + 0.1) continue;
            const ix = clamp(Math.floor((x - b.x0) / CELL), 0, b.nx - 1), iz = clamp(Math.floor((z - b.z0) / CELL), 0, b.nz - 1);
            if (tillOf(b.cells[iz * b.nx + ix]) > 0) { mesh.setMatrixAt(i, ZERO); n++; break; }
          }
        });
        if (n) mesh.instanceMatrix.needsUpdate = true;
        grassSeen.set(mesh, mesh.instanceMatrix.version + (n ? 1 : 0));
      }
    }
  }

  /* ================= plants: low-poly, built in code, instanced per crop and stage ================= */
  // geometry builder: parts are coloured, transformed primitives merged into one non-indexed geometry
  const M4 = new T.Matrix4(), Q = new T.Quaternion(), E3 = new T.Euler(), V3 = new T.Vector3(), SC = new T.Vector3();
  function part(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    M4.compose(V3.set(x, y, z), Q.setFromEuler(E3.set(rx, ry, rz, 'YXZ')), SC.set(sx, sy, sz));
    g.applyMatrix4(M4);
    const n = g.attributes.position.count, c = new Float32Array(n * 3), col = new T.Color(color);
    for (let i = 0; i < n; i++) { const s = 0.94 + 0.12 * hash(i, n); c[i * 3] = col.r * s; c[i * 3 + 1] = col.g * s; c[i * 3 + 2] = col.b * s; }
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
  // a leaf: a pointed blade along +z from the origin, with a raised midrib; bent down by `droop`
  function leafGeo(len, wid, droop = 0.3, segs = 3) {
    const p = [];
    const pt = (t, side) => { const w = Math.sin(Math.PI * Math.min(1, t * 1.05)) * wid * 0.5 * side, z = t * len, y = -droop * len * t * t + (side === 0 ? 0.012 * len : 0); return [w, y, z]; };
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs, t1 = (s + 1) / segs;
      const a = pt(t0, 0), b = pt(t1, 0), l0 = pt(t0, -1), l1 = pt(t1, -1), r0 = pt(t0, 1), r1 = pt(t1, 1);
      p.push(...a, ...l0, ...b, ...b, ...l0, ...l1, ...a, ...b, ...r0, ...r0, ...b, ...r1);
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(p), 3));
    return g;
  }
  // a strap leaf (corn, garlic, wheat, onion): long and narrow, arching
  const strapGeo = (len, wid, arch = 0.5) => leafGeo(len, wid, arch, 5);
  const ball = (r, d = 0) => new T.IcosahedronGeometry(r, d);
  const stick = (h, r, sides = 5) => { const g = new T.CylinderGeometry(r * 0.8, r, h, sides); g.translate(0, h / 2, 0); return g; };
  const cone = (h, r, sides = 6) => { const g = new T.ConeGeometry(r, h, sides); g.translate(0, h / 2, 0); return g; };
  // a ring of leaves around the stem: n leaves, each tilted `up` above horizontal
  function rosette(parts, n, len, wid, up, droop, color, y = 0, twist = 0, spread = 1) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + twist, l = len * (0.85 + 0.3 * hash(i, n * 7 + Math.round(len * 100)));
      parts.push(part(leafGeo(l, wid * spread, droop), color, 0, y, 0, -up, a, 0));
    }
  }
  const GREEN = 0x5e9b3e, DARK = 0x3d6b33, PALE = 0x9fcb62, STEM = 0x6f8f3a, BROWN = 0x8a6a3c, DEAD = 0x7a6544;
  const LOOK = {
    radish(st) {
      const p = [];
      const s = { seedling: 0.35, leafy: 0.8, ready: 1, past: 1.05, flowering: 1 }[st] || 0.4;
      rosette(p, st === 'seedling' ? 2 : 5, 0.11 * s, 0.07 * s, 0.75, 0.25, st === 'past' ? 0x7f9d48 : GREEN, 0.005);
      if (st === 'ready' || st === 'past') p.push(part(ball(0.028, 1), 0xc8384a, 0, 0.012, 0, 0, 0, 0, 1, 0.85, 1));
      if (st === 'flowering') { p.push(part(stick(0.4, 0.004), STEM)); p.push(part(ball(0.015), 0xf2e6f5, 0, 0.4, 0)); }
      return merge(p);
    },
    lettuce(st) {
      const p = [];
      const s = { seedling: 0.3, leafy: 0.7, ready: 1, past: 1.05 }[st] || 0.4;
      // loose leaf lettuce: rings of broad, ruffled, upturned leaves, paler inside
      rosette(p, 6, 0.13 * s, 0.11 * s, 0.35, 0.45, 0x8cc451, 0.01, 0, 1.1);
      if (st !== 'seedling') rosette(p, 5, 0.1 * s, 0.09 * s, 0.75, 0.3, 0xa9d86b, 0.02, 0.6);
      if (st === 'ready' || st === 'past') rosette(p, 4, 0.07, 0.07, 1.05, 0.15, 0xc4e68a, 0.03, 1.1);
      if (st === 'flowering') { p.push(part(stick(0.45, 0.009), 0x9cbf55)); rosette(p, 6, 0.06, 0.03, 0.6, 0.2, 0x8cc451, 0.18); rosette(p, 5, 0.05, 0.025, 0.6, 0.2, 0x8cc451, 0.3, 0.4); p.push(part(ball(0.025), 0xe6e09a, 0, 0.46, 0)); }
      return merge(p);
    },
    peas(st) {
      const p = [];
      const h = { seedling: 0.12, leafy: 0.45, flowering: 0.75, fruiting: 0.85, ready: 0.9, past: 0.9 }[st] || 0.1;
      const col = st === 'past' ? 0x9aa45a : 0x74b04f;
      p.push(part(stick(h, 0.006), col));
      // a twig stake to climb
      if (st !== 'seedling') p.push(part(stick(h + 0.12, 0.007), BROWN, 0.03, 0, 0.02, 0.05, 0, 0.04));
      for (let i = 0; i < Math.round(h / 0.1); i++) { const y = 0.06 + i * 0.1; p.push(part(leafGeo(0.07, 0.05, 0.2), col, 0, y, 0, -0.4, i * 2.4, 0)); p.push(part(leafGeo(0.06, 0.045, 0.2), col, 0, y + 0.03, 0, -0.4, i * 2.4 + Math.PI, 0)); }
      if (st === 'flowering' || st === 'fruiting') for (let i = 0; i < 3; i++) p.push(part(ball(0.014), 0xf6f3ea, 0.03 * Math.cos(i * 2), h * (0.55 + i * 0.12), 0.03 * Math.sin(i * 2)));
      if (st === 'fruiting' || st === 'ready') for (let i = 0; i < 4; i++) p.push(part(ball(0.012, 0), 0x8fcf5a, 0.035 * Math.cos(i * 1.7), h * (0.4 + i * 0.12), 0.035 * Math.sin(i * 1.7), 0, 0, 0.3, 1, 4.5, 1));
      return merge(p);
    },
    potato(st) {
      const p = [];
      const s = { seedling: 0.25, leafy: 0.75, flowering: 1, ready: 1, past: 0.8 }[st] || 0.3;
      const col = st === 'past' ? 0xa8a050 : GREEN;
      // a mounded bush of compound leaves on several stems
      for (let k = 0; k < 5; k++) {
        const a = k * 1.3, r = 0.05 * s;
        p.push(part(stick(0.3 * s, 0.008), STEM, r * Math.cos(a), 0, r * Math.sin(a), 0.35 * Math.cos(a), 0, 0.35 * Math.sin(a)));
        rosette(p, 4, 0.12 * s, 0.07 * s, 0.25, 0.35, col, 0.18 * s + 0.04 * k * s, a, 1);
      }
      if (st === 'flowering') for (let i = 0; i < 6; i++) p.push(part(ball(0.016), 0xf2eef8, 0.08 * Math.cos(i), 0.42 * s, 0.08 * Math.sin(i)));
      if (st === 'past') p.push(part(ball(0.035, 1), 0xc9a46a, 0.06, 0.01, 0.03));
      return merge(p);
    },
    tomato(st) {
      const p = [];
      const h = { seedling: 0.22, leafy: 0.55, flowering: 0.85, fruiting: 1.1, ready: 1.2, past: 1.2 }[st] || 0.2;
      if (st !== 'seedling') p.push(part(stick(1.45, 0.012, 4), 0xa47a4a, 0.07, 0, 0));   // the stake
      p.push(part(stick(h, 0.013), 0x6b8f34));
      const col = st === 'past' ? 0x7d8f45 : 0x4e8a37;
      for (let i = 0; i < Math.max(2, Math.round(h / 0.11)); i++) {
        const y = 0.08 + i * 0.1, a = i * 2.39, l = 0.2 * (1.1 - (y / h) * 0.5);
        p.push(part(leafGeo(l, 0.11, 0.55), col, 0, y, 0, -0.35, a, 0));
      }
      if (st === 'flowering' || st === 'fruiting') for (let i = 0; i < 4; i++) p.push(part(ball(0.013), 0xf2d43a, 0.08 * Math.cos(i * 1.6), h * (0.5 + 0.12 * i), 0.08 * Math.sin(i * 1.6)));
      if (st === 'fruiting' || st === 'ready' || st === 'past') {
        const ripe = st !== 'fruiting';
        for (let i = 0; i < 7; i++) { const a = i * 2.1, r = 0.11; p.push(part(ball(0.035, 1), ripe ? (i % 3 === 2 ? 0xe2732e : 0xd23b27) : 0x7fb046, r * Math.cos(a), 0.25 + (i % 4) * 0.17, r * Math.sin(a))); }
      }
      return merge(p);
    },
    bean(st) {
      const p = [];
      const s = { seedling: 0.3, leafy: 0.75, flowering: 1, fruiting: 1, ready: 1, past: 0.95 }[st] || 0.3;
      const col = st === 'past' ? 0xa5a654 : 0x5f9e3c;
      // heart-shaped trifoliate leaves on a low bush
      for (let k = 0; k < 4; k++) { const a = k * 1.57 + 0.4; p.push(part(stick(0.25 * s, 0.006), STEM, 0, 0, 0, 0.45 * Math.cos(a), 0, 0.45 * Math.sin(a))); }
      for (let i = 0; i < 9; i++) { const a = i * 2.4, y = (0.1 + 0.03 * (i % 4)) * s * 1.6; p.push(part(leafGeo(0.1 * s, 0.09 * s, 0.3), col, 0.03 * Math.cos(a), y, 0.03 * Math.sin(a), -0.15, a, 0)); }
      if (st === 'flowering') for (let i = 0; i < 4; i++) p.push(part(ball(0.012), 0xf5f2fa, 0.05 * Math.cos(i * 1.5), 0.18 * s, 0.05 * Math.sin(i * 1.5)));
      if (st === 'fruiting' || st === 'ready') for (let i = 0; i < 6; i++) { const a = i * 1.1; p.push(part(stick(0.1, 0.006, 4), 0x7cbf45, 0.06 * Math.cos(a), 0.05, 0.06 * Math.sin(a), 0.2, a, 0.1)); }
      return merge(p);
    },
    carrot(st) {
      const p = [];
      const s = { seedling: 0.3, leafy: 0.75, ready: 1, past: 1.05 }[st] || 0.3;
      // fine, feathery fronds: many narrow divided leaves rising steeply
      for (let i = 0; i < (st === 'seedling' ? 3 : 7); i++) {
        const a = i * 0.9, l = 0.25 * s * (0.8 + 0.4 * hash(i, 3));
        p.push(part(stick(l * 0.5, 0.003, 3), 0x5e9638, 0, 0, 0, 0.35 * Math.cos(a), 0, 0.35 * Math.sin(a)));
        p.push(part(leafGeo(l * 0.6, 0.05, 0.25, 4), 0x5e9638, Math.sin(0.35 * Math.cos(a)) * l * 0.45, l * 0.42, -Math.sin(0.35 * Math.sin(a)) * l * 0.45, -1.0, a, 0));
      }
      if (st === 'ready' || st === 'past') p.push(part(cone(0.03, 0.017, 6), 0xe8822e, 0, -0.012, 0, Math.PI, 0, 0));
      return merge(p);
    },
    squash(st) {
      const p = [];
      const s = { seedling: 0.25, leafy: 0.6, flowering: 0.9, fruiting: 1, ready: 1, past: 0.9 }[st] || 0.25;
      const col = st === 'past' ? 0x9a9a52 : 0x4f8a3a;
      // big round leaves on long stalks sprawling from the crown, and a vine running out
      for (let i = 0; i < 9; i++) {
        const a = i * 0.72, r = (0.12 + 0.25 * (i % 3)) * s;
        p.push(part(stick(0.18 * s, 0.008), 0x7a9a46, r * Math.cos(a), 0, r * Math.sin(a), 0.2, 0, 0));
        p.push(part(leafGeo(0.22 * s, 0.24 * s, 0.25), col, r * Math.cos(a), 0.17 * s, r * Math.sin(a), -0.5, a + 1.2, 0));
      }
      if (st === 'flowering' || st === 'fruiting') for (let i = 0; i < 3; i++) p.push(part(cone(0.05, 0.03, 5), 0xf4b62a, 0.25 * Math.cos(i * 2), 0.06, 0.25 * Math.sin(i * 2), Math.PI, 0, 0));
      if (st === 'fruiting' || st === 'ready' || st === 'past') {
        const ripe = st !== 'fruiting';
        for (let i = 0; i < 2; i++) { const a = i * 2.6 + 0.5; p.push(part(ball(0.07, 1), ripe ? 0xd9a35a : 0x9ab25a, 0.3 * Math.cos(a), 0.06, 0.3 * Math.sin(a), 0, a, Math.PI / 2, 1, 1.8, 1)); }
      }
      return merge(p);
    },
    kale(st) {
      const p = [];
      const s = { seedling: 0.3, leafy: 0.7, ready: 1, past: 1.1 }[st] || 0.3;
      // lacinato: a short stem crowned by long, narrow, dark blue-green leaves, arching out
      p.push(part(stick(0.18 * s, 0.014), 0x6f8a5a));
      for (let i = 0; i < 8; i++) { const a = i * 2.4; p.push(part(leafGeo(0.32 * s, 0.07 * s, 0.35, 4), i < 3 ? 0x2f5a44 : 0x3f6b4e, 0, 0.12 * s + 0.02 * i * s, 0, -0.9 + i * 0.05, a, 0)); }
      return merge(p);
    },
    garlic(st) {
      const p = [];
      const s = { seedling: 0.3, leafy: 0.75, ready: 1, past: 1 }[st] || 0.3;
      for (let i = 0; i < 6; i++) { const a = i * 2.6; p.push(part(strapGeo(0.4 * s, 0.025, 0.25), st === 'ready' && i < 3 ? 0xb4a060 : st === 'past' ? 0xa08f5a : 0x6e9a6a, 0, 0.02, 0, -1.25, a, 0)); }
      if (st === 'ready') p.push(part(stick(0.45, 0.004), 0x7ea06a));
      return merge(p);
    },
    corn(st) {
      const p = [];
      const h = { seedling: 0.2, leafy: 0.9, flowering: 1.7, fruiting: 1.8, ready: 1.8, past: 1.75 }[st] || 0.2;
      const col = st === 'past' ? 0xb4a65a : 0x5c9a3a;
      p.push(part(stick(h, 0.018), 0x7aa648));
      for (let i = 0; i < Math.max(2, Math.round(h / 0.2)); i++) { const y = 0.1 + i * 0.18; if (y > h - 0.1) break; p.push(part(strapGeo(0.55 * Math.min(1, h / 1), 0.06, 0.65), col, 0, y, 0, -0.75, i * Math.PI + 0.3 * i, 0)); }
      if (h > 1.2) for (let i = 0; i < 5; i++) p.push(part(stick(0.2, 0.004, 3), 0xd8c37a, 0, h - 0.02, 0, 0.5 * Math.cos(i * 1.26), 0, 0.5 * Math.sin(i * 1.26) * (i ? 1 : 0)));   // the tassel
      if (st === 'fruiting' || st === 'ready' || st === 'past') { p.push(part(ball(0.035, 0), 0x8dbf55, 0.04, h * 0.5, 0, 0.3, 0, -0.3, 1, 4, 1)); p.push(part(stick(0.06, 0.008, 4), 0xc9a86a, 0.07, h * 0.5 + 0.11, 0, 0, 0, -0.5)); }
      return merge(p);
    },
    wheat(st) {
      const p = [];
      const h = { seedling: 0.12, leafy: 0.45, flowering: 0.8, fruiting: 0.85, ready: 0.85, past: 0.8 }[st] || 0.12;
      const gold = st === 'ready' || st === 'past', col = gold ? 0xd8b860 : 0x7dab4a;
      for (let i = 0; i < 4; i++) p.push(part(strapGeo(h * 0.6, 0.012, 0.3), col, 0, 0.01, 0, -1.2, i * 1.6, 0));
      if (st !== 'seedling' && st !== 'leafy') for (let i = 0; i < 3; i++) { const a = i * 2.1, r = 0.012; p.push(part(stick(h, 0.003, 3), col, r * Math.cos(a), 0, r * Math.sin(a))); p.push(part(ball(0.012, 0), gold ? 0xe2c46e : 0x9cc25a, r * Math.cos(a), h + 0.03, r * Math.sin(a), 0, 0, 0, 1, 3.5, 1)); }
      return merge(p);
    },
  };
  // a dead plant: the same shape, flattened and brown (the instance colour and scale do it)
  const plantMat = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
  if (G.fade) G.fade(plantMat, 0.05, 0.9, 0.035, false, false);   // the engine's shared breeze
  const geoCache = new Map();
  const geoFor = (c, st) => { if (st === 'sown') return sownGeo; const k = c + ':' + st; let g = geoCache.get(k); if (!g) { g = (LOOK[c] || LOOK.lettuce)(st); geoCache.set(k, g); } return g; };
  const meshes = new Map();    // key -> InstancedMesh
  const sownGeo = (() => { const g = part(ball(0.03, 1), 0x2e2219, 0, -0.012, 0, 0, 0, 0, 1, 0.35, 1); return merge([g]); })();
  const VIS_STAGE = { sown: 'sown', seedling: 'seedling', leafy: 'leafy', flowering: 'flowering', fruiting: 'fruiting', ready: 'ready', past: 'past' };
  // which look each crop has for each stage (crops without a flower or fruit look keep their leafy or ready look)
  const looksOf = { radish: ['seedling', 'leafy', 'ready', 'past', 'flowering'], lettuce: ['seedling', 'leafy', 'ready', 'past', 'flowering'], carrot: ['seedling', 'leafy', 'ready', 'past'],
    kale: ['seedling', 'leafy', 'ready', 'past'], garlic: ['seedling', 'leafy', 'ready', 'past'] };
  function lookStage(c, st, p) {
    if (st === 'sown') return 'sown';
    if (p.bolted && (c === 'lettuce' || c === 'radish')) return 'flowering';
    const l = looksOf[c];
    if (!l) return st;
    if (st === 'flowering' || st === 'fruiting') return 'leafy';
    return st;
  }
  const _m = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _p = new T.Vector3(), _s = new T.Vector3(), _col = new T.Color();
  let plantSig = '';
  // place every visible plant; called only when something visible changed
  function layoutPlants() {
    const s = S(), counts = new Map(), lists = new Map();
    for (const p of Object.values(s.plants)) {
      const b = s.field.groups[p.bed]; if (!b) continue;
      const info = read.stageOf(p);
      const st = VIS_STAGE[info.stage]; if (!st) continue;
      const k = p.crop + ':' + lookStage(p.crop, st, p);
      if (!lists.has(k)) lists.set(k, []);
      lists.get(k).push(p);
      counts.set(k, (counts.get(k) || 0) + CROPS[p.crop].per);
    }
    for (const [k, m] of meshes) if (!counts.has(k)) { m.count = 0; m.visible = false; }
    for (const [k, list] of lists) {
      const need = counts.get(k);
      let m = meshes.get(k);
      if (!m || m.instanceMatrix.count < need) {
        if (m) { G.scene.remove(m); m.dispose(); }
        const [c, st] = k.split(':');
        m = new T.InstancedMesh(geoFor(c, st), plantMat, Math.max(16, Math.ceil(need * 1.5)));
        m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
        meshes.set(k, m); G.scene.add(m);
      }
      let n = 0;
      for (const p of list) {
        const b = s.field.groups[p.bed], span = p.span || 1, ix = p.cell % b.nx, iz = Math.floor(p.cell / b.nx);
        const per = CROPS[p.crop].per, grid = Math.ceil(Math.sqrt(per));
        const info = read.stageOf(p);
        // growth within a stage: plants swell as they go, and wilt, yellow or brown with their state
        const grow = clamp(0.55 + 0.45 * info.within, 0.5, 1.08) * (p.dead ? 0.85 : 1);
        const wilt = p.dead ? 1 : p.wilt || 0;
        for (let j = 0; j < per; j++) {
          const gx = j % grid, gz = Math.floor(j / grid);
          const cx = b.x0 + (ix + (span === 1 ? (gx + 0.5) / grid : span / 2)) * CELL + (hash(p.cell * 13 + j, 5) - 0.5) * 0.04 * (span === 1 ? 1 : 0);
          const cz = b.z0 + (iz + (span === 1 ? (gz + 0.5) / grid : span / 2)) * CELL + (hash(p.cell * 17 + j, 9) - 0.5) * 0.04 * (span === 1 ? 1 : 0);
          const y = gy(cx, cz) + RAISE;
          const sc = grow * (0.9 + 0.2 * hash(p.cell, j + 3));
          _e.set(wilt * 0.35 * (hash(j, p.cell) - 0.5) * 2, hash(p.cell * 3 + j, 1) * Math.PI * 2, wilt * 0.3, 'YXZ');
          _m.compose(_p.set(cx, y, cz), _q.setFromEuler(_e), _s.set(sc, sc * (1 - 0.32 * wilt), sc));
          m.setMatrixAt(n, _m);
          // colour: yellowing for hunger, burnt for frost, brown for dead
          _col.setRGB(1, 1, 1);
          if (p.dead) _col.setRGB(1.05, 0.78, 0.45);
          else {
            const y2 = p.yellow || 0, fb = Math.min(1, (p.frostBurn || 0) * 1.5);
            _col.setRGB(1 + 0.25 * y2, 1 + 0.08 * y2, 1 - 0.55 * y2);
            if (fb > 0) _col.lerp(_c.setRGB(0.75, 0.55, 0.45), fb * 0.7);
          }
          m.setColorAt(n, _col);
          n++;
        }
      }
      m.count = n; m.visible = n > 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
  // a short signature of everything that changes how plants look
  function plantSignature() {
    let sig = (LS() ? LS().rev : 0) + ':';
    for (const p of Object.values(S().plants)) {
      const info = read.stageOf(p);
      sig += p.id + info.stage + Math.round(info.within * 6) + (p.wilt > 0.35 ? 'w' : '') + (p.yellow > 0.35 ? 'y' : '') + (p.dead ? 'd' : '') + (p.bolted ? 'b' : '') + ((p.frostBurn || 0) > 0.25 ? 'f' : '') + ';';
    }
    return sig;
  }

  /* ================= weeds: small tufts on cells as the weeds take hold ================= */
  const weedGeo = (() => { const p = []; for (let i = 0; i < 5; i++) p.push(part(leafGeo(0.07, 0.025, 0.4), i % 2 ? 0x6f9a3a : 0x5a8a32, 0, 0, 0, -0.7, i * 1.25, 0)); return merge(p); })();
  const weedMesh = new T.InstancedMesh(weedGeo, plantMat, 2048); weedMesh.count = 0; weedMesh.frustumCulled = false; weedMesh.receiveShadow = true; G.scene.add(weedMesh);
  let weedSig = '';
  function layoutWeeds() {
    let n = 0, sig = '';
    for (const b of Object.values(S().field.groups)) for (let i = 0; i < b.cells.length && n < 2040; i++) {
      const w = b.cells[i].till === undefined || b.cells[i].till >= 1 ? b.cells[i].weed : 0, k = w > 0.7 ? 3 : w > 0.4 ? 2 : w > 0.15 ? 1 : 0;
      sig += k;
      for (let j = 0; j < k; j++) {
        const x = b.x0 + ((i % b.nx) + 0.15 + 0.7 * hash(i * 5 + j, 21)) * CELL, z = b.z0 + (Math.floor(i / b.nx) + 0.15 + 0.7 * hash(i * 3 + j, 23)) * CELL;
        const sc = 0.7 + 0.6 * hash(i + j, 2) + w * 0.5;
        _m.compose(_p.set(x, gy(x, z) + RAISE, z), _q.setFromEuler(_e.set(0, hash(i, j) * 6.28, 0)), _s.set(sc, sc, sc));
        weedMesh.setMatrixAt(n++, _m);
      }
    }
    if (sig === weedSig) return;
    weedSig = sig; weedMesh.count = n; weedMesh.instanceMatrix.needsUpdate = true;
  }

  /* ================= what the hands hold: big, chunky, readable from above ================= */
  const toolMat = new T.MeshLambertMaterial({ vertexColors: true });
  const box = (w, h, d) => new T.BoxGeometry(w, h, d);
  const mesh = (parts) => { const m = new T.Mesh(merge(parts), toolMat); m.castShadow = true; return m; };
  const ITEMSHOW = {};
  // the hoe: its blade at the origin, the handle up along +y
  ITEMSHOW.hoe = { obj: mesh([part(stick(1.55, 0.05, 6), 0xc9975a, 0, 0.04, 0), part(box(0.44, 0.07, 0.26), 0xc3ccd3, 0, 0.03, 0.11, 0.35), part(box(0.14, 0.12, 0.1), 0x7d868c, 0, 0.08, 0)]),
    use: 'tip', still: [0.44, 0.02, 0.22, 0, 0, 0], stillArm: -0.5, walk: [0.3, 1.74, -0.78, 2.15, 0, 0], walkArm: -1.0 };
  // the watering can: body on the origin, spout and rose ahead (+z), handle behind
  ITEMSHOW.can = { obj: mesh([part(new T.CylinderGeometry(0.17, 0.19, 0.3, 10), 0x4f8fb5, 0, 0.15, 0), part(stick(0.42, 0.035, 6), 0x5c9cc2, 0, 0.1, 0.14, 0.95), part(new T.CylinderGeometry(0.085, 0.05, 0.06, 8), 0xd9e6ee, 0, 0.345, 0.48, 0.95),
    part(box(0.05, 0.3, 0.05), 0x3f7699, 0, 0.2, -0.24), part(box(0.05, 0.05, 0.12), 0x3f7699, 0, 0.34, -0.19), part(box(0.05, 0.05, 0.12), 0x3f7699, 0, 0.08, -0.19)]),
    use: 'over', overD: 0.6, overH: 0.78, tiltMax: 0.95, still: [0.4, 0.5, 0.1, 0, 0, 0], stillArm: -0.12 };
  const ROSE = new T.Vector3(0, 0.37, 0.52);
  // the trowel: a pointed scoop at the origin, a short handle up +y
  ITEMSHOW.trowel = { obj: mesh([part(new T.ConeGeometry(0.06, 0.16, 6, 1, true), 0xb9c2c9, 0, 0.06, 0, Math.PI, 0, 0, 1, 1, 0.45), part(stick(0.05, 0.012, 5), 0x7d868c, 0, 0.13, 0), part(stick(0.13, 0.022, 6), 0xc9975a, 0, 0.17, 0)]),
    use: 'tip', still: [0.3, 0.75, 0.32, -0.6, 0, 0], stillArm: -1.0 };
  ITEMSHOW.mulch = { obj: mesh([part(new T.CylinderGeometry(0.2, 0.16, 0.26, 10), 0x8a8f94, 0, 0.13, 0), part(ball(0.19, 1), 0xe0c070, 0, 0.27, 0, 0, 0, 0, 1, 0.6, 1)]), use: 'over', overD: 0.55, overH: 0.8, tiltHold: 0.9, tiltMax: 0.3, still: [0.4, 0.5, 0.12, 0, 0, 0], stillArm: -0.15 };
  ITEMSHOW.compost = { obj: mesh([part(new T.CylinderGeometry(0.2, 0.16, 0.26, 10), 0x8a8f94, 0, 0.13, 0), part(ball(0.19, 1), 0x4a3324, 0, 0.27, 0, 0, 0, 0, 1, 0.6, 1)]), use: 'over', overD: 0.55, overH: 0.8, tiltHold: 0.9, tiltMax: 0.3, still: [0.4, 0.5, 0.12, 0, 0, 0], stillArm: -0.15 };
  const packetShow = {};
  const packetOf = (c) => packetShow[c] || (packetShow[c] = { obj: mesh([part(box(0.22, 0.28, 0.04), 0xf2e8c8), part(box(0.22, 0.06, 0.045), 0xc9b98a, 0, 0.1, 0), part(ball(0.07, 1), CROPS[c].col, 0, -0.03, 0.02, 0, 0, 0, 1, 1, 0.35)]),
    use: 'hand', still: [0.3, 0.86, 0.36, -0.5, 0, 0], reach: [0.3, 0.8, 0.5, -1.1, 0, 0], stillArm: -1.0 });

  /* ================= marks on the ground: where seeds go; the stream from the can ================= */
  const dotGeo = new T.CircleGeometry(0.025, 8); dotGeo.rotateX(-Math.PI / 2);
  const dots = new T.InstancedMesh(dotGeo, new T.MeshBasicMaterial({ color: 0xfff2c4, transparent: true, opacity: 0.8, depthWrite: false }), 600);
  dots.count = 0; dots.renderOrder = 10; dots.frustumCulled = false; G.scene.add(dots);
  const drops = new T.InstancedMesh(new T.IcosahedronGeometry(0.03, 0), new T.MeshBasicMaterial({ color: 0xa9dcf7, transparent: true, opacity: 0.85 }), 16);
  drops.count = 0; drops.frustumCulled = false; G.scene.add(drops);
  // the engine's terrain-brush ring is meant for the Dig and Raise tools: hide it while gardening
  let engineRing = null;
  const findRing = () => engineRing || (engineRing = G.scene.children.find((o) => o.isMesh && o.geometry && o.geometry.type === 'RingGeometry' && o.geometry.parameters.innerRadius === 2.45) || null);

  /* ================= the hotbar, the seed box and the one hint line ================= */
  const money = (v) => '$' + (Math.round(v * 100) / 100).toFixed(v % 1 ? 2 : 0);
  const hasSeed = (c) => have(CROPS[c].seed) > 0 || (S().packets[c] || 0) > 0;
  const canDig = () => owns('hoe') || owns('spade') || owns('shovel');
  const held = () => H.held || 'hands';
  const heldCrop = () => (held().startsWith('seed:') ? held().slice(5) : null);
  function slotList() {
    const s = S(), out = [];
    out.push({ id: 'hands', name: 'Hands', icon: ICONS.hands, title: 'Hands: harvest and tend' });
    out.push({ id: 'hoe', name: 'Hoe', icon: ICONS.hoe, item: ITEMSHOW.hoe, dim: !canDig(), title: 'Hoe: break ground, weed, hill potatoes' });
    out.push({ id: 'can', name: 'Can', icon: ICONS.water, item: ITEMSHOW.can, dim: !owns('watering_can'), meter: owns('watering_can') ? s.can.litres / 9 : null, freezeY: true, title: 'Watering can' });
    out.push({ id: 'trowel', name: 'Trowel', icon: ICONS.trowel, item: ITEMSHOW.trowel, dim: !owns('trowel'), title: 'Trowel: tap for a planting hole, drag for a seed drill' });
    if (LS()) out.push({ id: 'shovel', name: 'Shovel', icon: ICONS.shovel, item: LS().items.shovel, dim: !owns('shovel') && !owns('spade'), badge: G.sim.state.sys.landscape.carry.m3 > 1e-6 ? Math.round(G.sim.state.sys.landscape.carry.m3 * 1000) + ' L' : null, title: 'Shovel: dig holes, heap hills and raised rows' });
    for (const c of CROP_IDS) if (hasSeed(c)) out.push({ id: 'seed:' + c, name: CROPS[c].name, icon: ICONS.packet(hexOf(CROPS[c].col)), item: packetOf(c), title: CROPS[c].name + ' seed' });
    if (have('mulch_straw') > 0) out.push({ id: 'mulch', name: 'Straw', icon: ICONS.mulch, item: ITEMSHOW.mulch, badge: Math.round(have('mulch_straw')) + ' L' });
    if (have('compost') > 0) out.push({ id: 'compost', name: 'Compost', icon: ICONS.compost, item: ITEMSHOW.compost, badge: Math.round(have('compost')) + ' L' });
    out.push({ id: 'box', name: 'Seed box', icon: ICONS.box, title: 'Seed box: buy seed, straw and compost' });
    return out;
  }
  function sowWord(c) {
    try { return read.sowAdvice(c, G.sim.state.sys.weather.site, read.doy(G.sim.state), life()); } catch (e) { return null; }
  }
  function renderSeeds() {
    let h = '';
    for (const c of CROP_IDS) {
      const it = ITEMS[CROPS[c].seed], own = have(it.id) + ((S().packets[c] || 0) > 0 ? 1e-6 : 0), adv = sowWord(c);
      const ownTxt = it.unit === 'kg' ? (Math.round(have(it.id) * 10) / 10) + ' kg' : String(Math.floor(have(it.id)));
      const open = S().packets[c] > 0 ? ' + open' : '';
      h += '<button type="button" class="gseed" data-crop="' + c + '"><b>' + esc(CROPS[c].name) + '<i style="background:' + hexOf(CROPS[c].col) + '"></i></b>' +
        '<span class="when' + (adv && adv.now ? '' : ' no') + '">' + esc(adv ? adv.short : '') + '</span>' +
        '<span>' + (CROPS[c].spacing >= 0.3 ? Math.round(CROPS[c].spacing * 100) + ' cm apart' : CROPS[c].count + ' to a 30 cm square') + '</span>' +
        (own > 0 ? '<span class="own">You have ' + ownTxt + open + '</span>' : '<span>Buy for ' + money(it.priceUsd) + (it.unit === 'kg' ? ' a kg' : '') + '</span>') + '</button>';
    }
    if (!owns('trowel')) h += '<button type="button" class="gseed" data-buy="trowel" data-qty="1"><b>Hand trowel</b><span>Planting holes and seed drills</span><span>Buy for ' + money(ITEMS.trowel.priceUsd) + '</span></button>';
    for (const [id, nm, q] of [['mulch_straw', 'Straw mulch', 150], ['compost', 'Compost', 40]])
      h += '<button type="button" class="gseed" data-buy="' + id + '" data-qty="' + q + '"><b>' + nm + '</b><span>' + (id === 'compost' ? 'Feeds the soil for months' : 'Keeps soil moist, weeds down') + '</span><span>' + (have(id) > 0 ? 'You have ' + Math.round(have(id)) + ' L. ' : '') + 'Buy ' + q + ' L for ' + money(ITEMS[id].priceUsd * q) + '</span></button>';
    seedsEl.innerHTML = h;
  }
  seedsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.gseed'); if (!b) return;
    if (b.dataset.buy) {
      const r = cmd('stock.buy', { id: b.dataset.buy, qty: +b.dataset.qty });
      say(r.ok ? 'Bought.' : 'Not enough money.');
      if (r.ok) { H.setSlots(slotList()); H.hold(b.dataset.buy === 'compost' ? 'compost' : b.dataset.buy === 'trowel' ? 'trowel' : 'mulch'); }
      canvas.focus(); return;
    }
    crop = b.dataset.crop;
    const it = ITEMS[CROPS[crop].seed];
    if (!hasSeed(crop)) {
      const r = cmd('stock.buy', { id: it.id, qty: 1 });
      say(r.ok ? 'Bought ' + it.name.toLowerCase() + '.' : 'Not enough money for ' + it.name.toLowerCase() + '.');
    }
    if (hasSeed(crop)) { H.setSlots(slotList()); H.hold('seed:' + crop); }
    else renderSeeds();
    canvas.focus();
  });
  let sayTo = null;   // while the Yard borrows the can, its messages go to the Yard's bar
  function say(msg, secs = 3) { if (sayTo) return sayTo(msg, secs); flash.msg = msg; flash.until = performance.now() + secs * 1000; updateHint(true); }
  function buyButton(id, label) { return ' <button type="button" class="go" data-buy="' + id + '">' + esc(label) + ' ' + money(ITEMS[id].priceUsd) + '</button>'; }
  hint.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.buy) { const r = cmd('stock.buy', { id: b.dataset.buy, qty: 1 }); say(r.ok ? 'Bought.' : 'Not enough money.'); if (b.dataset.buy === 'watering_can' && r.ok) cmd('garden.refill', {}); }
    if (b.dataset.act === 'refill') { cmd('garden.refill', {}); say('Filled the can: 9 litres.'); }
    if (b.dataset.act === 'cover') { const r = cmd('garden.cover', {}); say(r.ok ? (r.on ? 'The beds are under fleece.' : 'Covers off.') : r.reason); }
    updateHint(true); canvas.focus();
  });
  function onHold(id) {
    seedsEl.hidden = id !== 'box';
    if (id === 'box') renderSeeds();
    if (id.startsWith('seed:')) crop = id.slice(5);
    dots.count = 0; dotKey = ''; drops.count = 0;
    updateHint(true);
  }
  function updateHint(force) {
    const s = S(), can = s.can.litres, id = held(), c = heldCrop();
    let h;
    const now = performance.now();
    if (flash.until > now) h = esc(flash.msg);
    else if (id === 'hands') h = '<b>Pull</b> a root crop up, <b>swipe</b> across leaves to cut them, <b>click</b> fruit to pick it. <b>F</b> looks closer.';
    else if (id === 'trowel') h = owns('trowel') ? '<b>Tap</b> worked soil for a planting hole, or <b>drag</b> along the row to draw a seed drill. Potatoes, garlic, squash and tomatoes go in holes.' : 'You need a trowel to open the soil for seed.' + buyButton('trowel', 'Buy a trowel');
    else if (id === 'shovel') h = G.sim.state.sys.landscape.carry.m3 > 1e-6 ? '<b>Press and drag</b> the load where it goes, let go to drop it.' : '<b>Press</b> to dig a scoop, <b>drag</b> it where it goes and <b>let go</b>: heap a hill for squash, bank up a row. A click drops it beside the hole.';
    else if (id === 'hoe') h = canDig() ? '<b>Press</b> the blade into the ground and <b>drag</b> it toward you. ' + (owns('hoe') ? 'Two strokes' : 'Three strokes') + ' turn grass into fine soil.' + (owns('hoe') ? '' : buyButton('hoe', 'A real hoe is quicker')) : 'You need a hoe.' + buyButton('hoe', 'Buy a hoe');
    else if (id === 'can') {
      if (!owns('watering_can')) h = 'You need a watering can.' + buyButton('watering_can', 'Buy a can');
      else if (can < 0.05) h = 'The can is empty. ' + (source.kind === 'none' ? 'There is no pump or pond near. <button type="button" data-act="refill">Fill it here (for now)</button>' : source.kind === 'pond' && !source.fixtures ? '<b>Dip</b> it in the water to fill it.' : 'Fill it at the pump by the well: <b>hold</b> the can under the spout and <b>pump</b> the handle (drag down, let go).');
      else h = '<b>Hold</b> to lift the can, then <b>drag down</b> to tip it and pour. Walk along the row while it pours. <span id="gcan"><i style="width:' + Math.round((can / 9) * 100) + '%"></i></span>' + can.toFixed(1) + ' L';
    } else if (c) { const adv = sowWord(c); h = (DEEP[c] ? '<b>Click</b> a hole you have dug with the trowel to set the ' + esc(CROPS[c].name.toLowerCase()) + ' in it.' : '<b>Click</b> an open drill or hole to drop ' + esc(CROPS[c].name.toLowerCase()) + ' seed, or <b>hold and drag</b> along the drill.') + (adv && adv.short ? ' <span style="color:' + (adv.now ? '#cfe3a6' : '#e8b48c') + '">' + esc(adv.short) + '.</span>' : ''); }
    else if (id === 'mulch') h = '<b>Hold and sweep</b> over the bed to scatter straw: it keeps the soil moist and the weeds down.';
    else if (id === 'compost') h = '<b>Hold and sweep</b> over the bed to scatter compost. It feeds the soil for months.';
    else h = 'Take a packet from the seed box to hold it.';
    const fr = read.frostTonight(G.sim.state.sys.weather);
    if (fr.level === 'likely' && Object.keys(s.plants).length && Object.values(s.field.groups).some((b) => !b.cover) && flash.until <= now) h = '<b>' + esc(fr.text) + '</b> Cover the beds tonight. <button type="button" class="go" data-act="cover">Cover the beds</button><br>' + h;
    if (h !== hintSig || force) { hintSig = h; hint.innerHTML = h; }
  }

  /* ================= water to fill the can: a pump, tap or tank of the water system, or a pond ================= */
  const source = { kind: 'none', fixtures: false, t: 0 };
  const waterPieces = () => { try { return (window.__build ? window.__build.pieces() : []).filter((p) => p.kind === 'fixture' && p.system === 'water' && /^(outlet|pump|storage)$/.test(p.category)); } catch (e) { return []; } };
  // the sea's shallows, or a stream deep enough to dip a can in (G.streamWaterAt: src/engine.js)
  const streamAt = (x, z) => { const w = G.streamWaterAt ? G.streamWaterAt(x, z) : null; return w && w.depth > 0.06 ? w : null; };
  const isPond = (x, z) => G.heightAt(x, z) < (G.sea || 0) - 0.08 || !!streamAt(x, z);
  const waterY = (x, z) => { const w = streamAt(x, z); return w ? G.heightAt(x, z) + w.depth : (G.sea || 0); };
  function findSources() {
    const P = G.player;
    source.fixtures = waterPieces().length > 0; source.kind = source.fixtures ? 'fixture' : 'none';
    if (!source.fixtures) for (let r = 4; r <= 64 && source.kind === 'none'; r += 6) for (let a = 0; a < 16; a++) if (isPond(P.x + Math.sin(a * 0.3927) * r, P.z + Math.cos(a * 0.3927) * r)) { source.kind = 'pond'; break; }
  }
  function fixtureNear(x, z) {
    let best = null, bd = 1.1;
    for (const p of waterPieces()) { const d = Math.hypot(p.a.x - x, p.a.z - z); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  let draw = null;   // water asked of a fixture and not yet all in the can: { id, credited }
  function settleDraw() {
    const w = G.sim.state.sys.water, r = w && w.results && w.results[draw.id];
    if (!r) { draw = null; return; }
    const d = r.suppliedL - draw.credited;
    if (d > 0.001) { cmd('garden.refill', { litres: d }); draw.credited += d; }
    if (r.done) { if (draw.credited < 0.01) say('No water came' + (r.reason ? ': ' + String(r.reason).replace(/[-_]/g, ' ') : '') + '.'); draw = null; }
  }
  function drawFrom(piece, litres) {
    if (draw) settleDraw();
    try { G.sim.commandNow('water.draw', { id: piece.id, litres }); draw = { id: String(piece.id), credited: 0 }; settleDraw(); } catch (e) { say('No water came.'); }
    G.burst(piece.a.x, (piece.y1 || G.heightAt(piece.a.x, piece.a.z) + 0.8) - 0.1, piece.a.z, 12, 0x9fd4f2, 0.6, 0.3, 0.06, 0.5);
  }

  /* ================= the gestures ================= */
  const act = { kind: '', acc: 0, n: 0, piece: null, armed: true, grab: null, done: false, lastKey: 0, lx: 0, lz: 0, why: '' };
  const strokeCells = new Set(), batch = [];
  const keyOf = (gx, gz) => (gx + 50000) * 100000 + (gz + 50000);
  const _w = new T.Vector3(), _dm = new T.Matrix4();

  // --- the hoe: every square the blade passes over is worked once per stroke
  function hoeAlong(x0, z0, x1, z1) {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(len / 0.1));
    batch.length = 0;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, z = z0 + ((z1 - z0) * i) / n;
      const gx0 = Math.floor((x - HOE_W) / CELL), gx1 = Math.floor((x + HOE_W) / CELL), gz0 = Math.floor((z - HOE_W) / CELL), gz1 = Math.floor((z + HOE_W) / CELL);
      for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
        if (Math.hypot((gx + 0.5) * CELL - x, (gz + 0.5) * CELL - z) > HOE_W + 0.02) continue;
        if (isPond((gx + 0.5) * CELL, (gz + 0.5) * CELL)) continue;
        const k = keyOf(gx, gz);
        if (!strokeCells.has(k)) { strokeCells.add(k); batch.push([gx, gz]); }
      }
    }
    if (!batch.length) return;
    const res = cmd('garden.till', { cells: batch });
    if (!res.ok) { say(res.reason); return; }
    act.n += batch.length;
    const y = gy(x1, z1);
    G.burst(x1, y + 0.12, z1, 5 + batch.length * 2, 0x5a4230, 1.5, 2.6, 0.075, 0.6);       // clods
    if (res.broke) { G.burst(x1, y + 0.12, z1, 6, 0x5e8a3a, 1.6, 2.6, 0.07, 0.7); }             // torn sod
    if (res.clearedM2 > 0.004) G.burst(x1, y + 0.1, z1, 5, 0x6f9a3a, 1.2, 1.8, 0.05, 0.5);  // cut weeds
    if (res.worked) { G.burst(x1, y + 0.1, z1, 6, 0x3a2c22, 1.0, 1.6, 0.06, 0.5); tipEvent('bed'); }   // fine dark crumbs when the soil comes right
    // ground the shovel has shaped: the hoe breaks its clods and smooths its lumps, keeping its shape (a hill stays a
    // hill, a hollow a hollow), and leaves it loose: a seedbed made on the shape you dug
    if (LS() && G.sim.handlers.has('landscape.tilth')) {
      const lg = G.sim.state.sys.landscape.grid;
      for (const [gx, gz] of batch) {
        const x = (gx + 0.5) * CELL, z = (gz + 0.5) * CELL;
        if (G.earthwork.sAt(lg, Math.round(x / lg.step), Math.round(z / lg.step))) cmd('landscape.tilth', { x, z });
      }
    }
    // hilling: the blade drawn past a potato pulls soil up round its stems from the free ground beside it
    if (LS()) for (const [gx, gz] of batch) {
      const p = plantAt((gx + 0.5) * CELL, (gz + 0.5) * CELL);
      if (!p || !HILL[p.crop] || p.dead) continue;
      const hOf = (x, z) => G.landscape.reliefAt(G.sim.state, (x + 0.5) * CELL, (z + 0.5) * CELL);
      if (hOf(gx, gz) > 0.16) continue;
      let from = null, fh = -9;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = gx + dx, nz = gz + dz, np = plantAt((nx + 0.5) * CELL, (nz + 0.5) * CELL);
        if (np || !cellAt((nx + 0.5) * CELL, (nz + 0.5) * CELL)) continue;
        const h = hOf(nx, nz); if (h > fh) { fh = h; from = [nx, nz]; }
      }
      if (from && cmd('landscape.move', { from: [(from[0] + 0.5) * CELL, (from[1] + 0.5) * CELL], to: [(gx + 0.5) * CELL, (gz + 0.5) * CELL], m3: 0.0025 }).ok) { act.hill = (act.hill || 0) + 1; G.burst((gx + 0.5) * CELL, y + 0.1, (gz + 0.5) * CELL, 5, 0x5a4230, 1.0, 1.4, 0.05, 0.45); }
    }
  }
  const HOE_W = 0.2;

  // --- seed: one square at a time as the hand passes
  function sowAt(a, first) {
    const c = cellAt(a.x, a.z), cr = heldCrop();
    if (!cr) return;
    if (!c || tillOf(c.bed.cells[c.i]) < 1) { if (first) say(c ? 'This ground is only half worked: pull the hoe through it once more.' : 'Seed only takes in worked soil. Break the ground with the hoe first.'); return; }
    const span = spanOf(cr), ix = c.ix - (c.ix % span), iz = c.iz - (c.iz % span), i = iz * c.bed.nx + ix, k = keyOf(ix, iz) + 7;
    if (k === act.lastKey) return;
    act.lastKey = k;
    if (c.bed.cells[i].pl) { if (first) say('Something is already growing there.'); return; }
    // the seed goes where the trowel opened the soil: snap to the open square under the hand
    if (span === 1 && !c.bed.cells[i].open) { if (first) say(DEEP[cr] ? CROPS[cr].plural.replace(/^./, (m) => m.toUpperCase()) + ' go in a hole: tap the soil with the trowel first.' : 'Open a drill first: drag the trowel along the row.'); act.lastKey = 0; return; }
    const res = cmd('garden.sow', { crop: cr, bed: c.bed.id, cells: [i], inOpening: true });
    if (!res.ok) { if (first || !act.why) say(res.reason); act.why = res.reason; return; }
    act.n += res.plants;
    const x = c.bed.x0 + (ix + span / 2) * CELL, z = c.bed.z0 + (iz + span / 2) * CELL, y = gy(x, z) + RAISE;
    G.burst(x, y + 0.25, z, 5, 0xf2dfa0, 0.25, -0.6, 0.035, 0.35);   // the seed falls
    G.burst(x, y + 0.04, z, 6, 0x6b4f35, 0.7, 1.0, 0.045, 0.4);      // and is pressed in with a puff
    dotKey = '';
    if (!hasSeed(cr)) { say('That was the last of the ' + CROPS[cr].name.toLowerCase() + ' seed.'); }
  }
  // faint marks where this packet's seeds belong, around the aimed spot
  let dotKey = '';
  function spacingMarks(a) {
    const cr = heldCrop();
    if (!cr || !a.valid) { if (dots.count) dots.count = 0; dotKey = ''; return; }
    const k = Math.round(a.x / CELL) + ':' + Math.round(a.z / CELL) + cr;
    if (k === dotKey) return;
    dotKey = k;
    const span = spanOf(cr), per = CROPS[cr].per, grid = Math.ceil(Math.sqrt(per));
    let n = 0;
    for (const b of Object.values(S().field.groups)) {
      const ia = Math.floor((a.x - 0.75 - b.x0) / CELL), ib = Math.floor((a.x + 0.75 - b.x0) / CELL), ja = Math.floor((a.z - 0.75 - b.z0) / CELL), jb = Math.floor((a.z + 0.75 - b.z0) / CELL);
      for (let iz = Math.max(0, ja); iz <= Math.min(b.nz - 1, jb); iz++) for (let ix = Math.max(0, ia); ix <= Math.min(b.nx - 1, ib); ix++) {
        if (span > 1 && (ix % span || iz % span)) continue;
        const cell = b.cells[iz * b.nx + ix];
        if (cell.pl || tillOf(cell) < 1) continue;
        if (span > 1) { let hole = false; for (let dz = 0; dz < span && !hole; dz++) for (let dx = 0; dx < span; dx++) { const q = b.cells[(iz + dz) * b.nx + ix + dx]; if (q && q.open === 2) { hole = true; break; } } if (!hole) continue; }
        else if (!cell.open || (DEEP[cr] && cell.open !== 2)) continue;
        for (let j = 0; j < per && n < 600; j++) {
          const x = b.x0 + (ix + (span > 1 ? span / 2 : ((j % grid) + 0.5) / grid)) * CELL, z = b.z0 + (iz + (span > 1 ? span / 2 : (Math.floor(j / grid) + 0.5) / grid)) * CELL;
          _dm.makeTranslation(x, gy(x, z) + RAISE + 0.03, z); dots.setMatrixAt(n++, _dm);
        }
      }
    }
    dots.count = n; dots.instanceMatrix.needsUpdate = true;
  }

  // --- hands: each crop comes away with its own motion
  const MOTION = { pull: 'up', dig: 'up', cut: 'side', reap: 'side', pick: 'click', twist: 'click' };
  const plantAt = (x, z) => { const c = cellAt(x, z), id = c && c.bed.cells[c.i].pl; return id && S().plants[id] ? S().plants[id] : null; };
  function takePlant(p, a) {
    const res = cmd('garden.harvest', { bed: p.bed, cells: [p.cell] });
    if (res.ok) { flourish(res); return true; }
    const st = read.stageOf(p).stage;
    if (p.dead || st === 'past' || (a && a.shift)) {
      const b = S().field.groups[p.bed], sp = p.span || 1, x = b.x0 + ((p.cell % b.nx) + sp / 2) * CELL, z = b.z0 + (Math.floor(p.cell / b.nx) + sp / 2) * CELL;
      if (cmd('garden.pull', { bed: p.bed, cells: [p.cell] }).ok) { G.burst(x, gy(x, z) + 0.2, z, 9, 0x6b4f35, 1.6, 2.4, 0.06, 0.6); say('Pulled it out. The bed is free to sow again.'); return true; }
    }
    return false;
  }
  function handsFrame(a) {
    const g = act.grab;
    if (g && !act.done) {
      const p = S().plants[g];
      if (!p) { act.done = true; return; }
      const m = MOTION[CROPS[p.crop].gesture] || 'click';
      const far = Math.abs(a.dx) + Math.abs(a.dy) > 130;
      const k = m === 'up' ? a.lift : m === 'side' ? Math.min(1, a.side / 55) : 1;
      if (m === 'up' && a.lift > 0.25 && Math.random() < 0.25) G.burst(a.ox, a.y + 0.08, a.oz, 1, 0x6b4f35, 0.8, 1.2, 0.04, 0.3);   // the soil gives a little
      if (k >= 1 || far) {
        act.done = true; act.sweep = m !== 'up';   // a cut or a pick carries on along the row; each root needs its own pull
        if (!takePlant(p, a)) say(read.plantStatus(G.sim.state, p.id).reason + (a.shift ? '' : ' (Hold Shift to pull it out anyway.)'), 4);
        else act.n++;
      }
    } else if (act.done && act.n && act.sweep) {
      // the hand keeps working along the row: whatever else is ready comes with a touch
      const p = plantAt(a.x, a.z);
      if (p && p.id !== g && cmdQuiet(p)) { const res = cmd('garden.harvest', { bed: p.bed, cells: [p.cell] }); if (res.ok) { flourish(res); act.n++; } }
    }
  }
  const cmdQuiet = (p) => { const s = read.plantStatus(G.sim.state, p.id); return s && /^Ready/.test(s.status); };

  // the trowel's tip drawn along the row opens a drill in each square it passes, along the way it was drawn
  function trowelFrame(a) {
    const dx = a.x - act.lx, dz = a.z - act.lz;
    if (!act.drill && Math.hypot(a.x - a.ox, a.z - a.oz) < 0.15) return;
    if (!act.drill) { act.drill = true; act.lx = a.ox; act.lz = a.oz; act.axis = Math.abs(a.x - a.ox) >= Math.abs(a.z - a.oz) ? 'x' : 'z'; }
    const len = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(len / 0.08)), cells = [];
    for (let i = 0; i <= n; i++) {
      const x = act.lx + (dx * i) / n, z = act.lz + (dz * i) / n, gx = Math.floor(x / CELL), gz = Math.floor(z / CELL), k = keyOf(gx, gz);
      if (!strokeCells.has(k)) { strokeCells.add(k); cells.push([gx, gz]); }
    }
    act.lx = a.x; act.lz = a.z;
    if (!cells.length) return;
    const res = cmd('garden.open', { cells, kind: 'drill', axis: act.axis });
    if (!res.ok) { if (!act.why) say(res.reason); act.why = res.reason; return; }
    if (res.cells) { act.n += res.cells; G.burst(a.x, gy(a.x, a.z) + RAISE + 0.04, a.z, 3, 0x5a4230, 0.8, 1.0, 0.035, 0.35); }
  }
  function press(a) {
    const id = held();
    act.kind = id; act.acc = 1; act.n = 0; act.grab = null; act.done = false; act.lastKey = 0; act.piece = null; act.armed = false; act.why = '';
    act.lx = a.x; act.lz = a.z;
    tag.hidden = true; tagSig = '';
    if (id === 'shovel') { if (LS()) { LS().bindSay(say); LS().tools.shovel.press(a); } return; }
    if (id === 'trowel') {
      if (!owns('trowel')) { act.kind = ''; return say('You need a trowel first.'); }
      strokeCells.clear(); act.drill = false;
      return;
    }
    if (id === 'hoe') {
      act.hill = 0;
      if (!canDig()) { act.kind = ''; return say('You need a hoe first.'); }
      strokeCells.clear();
      G.juice.hitStop = 0.045;   // the blade bites, like the axe landing
      hoeAlong(a.x, a.z, a.x, a.z);
    } else if (id === 'can') {
      if (!owns('watering_can')) { act.kind = ''; return say('You need a watering can first.'); }
      const fx = fixtureNear(a.x, a.z) || fixtureNear(G.player.x, G.player.z);
      if (fx) {
        act.kind = 'fill'; act.piece = fx;
        const room = 9 - S().can.litres;
        if (room < 0.05) say('The can is full.');
        else drawFrom(fx, fx.category === 'pump' ? Math.min(3, room) : room);
      } else if (isPond(a.x, a.z)) act.kind = 'dip';
    } else if (id.startsWith('seed:')) sowAt(a, true);
    else if (id === 'hands') {
      const p = plantAt(a.x, a.z);
      if (p) { act.grab = p.id; handsFrame(a); }
    }
  }
  function frameAct(a, dt) {
    if (draw) settleDraw();
    if (!a.down) { if (drops.count) drops.count = 0; if (on) spacingMarks(a); return; }
    const k = act.kind;
    act.acc += dt;
    if (k === 'shovel') { if (LS()) LS().tools.shovel.frame(a, dt); return; }
    if (k === 'trowel') { trowelFrame(a); return; }
    if (k === 'hoe') {
      if (Math.hypot(a.x - act.lx, a.z - act.lz) > 0.06) { hoeAlong(act.lx, act.lz, a.x, a.z); act.lx = a.x; act.lz = a.z; }
    } else if (k === 'can') {
      const can = S().can.litres, pouring = a.tip > 0.12 && can > 0.01;
      if (a.tip > 0.12 && can <= 0.01 && act.acc > 0.5) { act.acc = 0; say('The can is empty.'); }
      if (pouring) {
        // the stream: drops along an arc from the rose to the aimed spot
        ITEMSHOW.can.obj.updateWorldMatrix(true, false);
        _w.copy(ROSE).applyMatrix4(ITEMSHOW.can.obj.matrixWorld);
        const n = 4 + Math.round(a.tip * 10), tm = performance.now() * 0.0022;
        for (let i = 0; i < n; i++) {
          const t = (i / n + tm) % 1, sc = 0.7 + a.tip * 0.9;
          _dm.makeScale(sc, sc * 1.6, sc);
          _dm.setPosition(_w.x + (a.x - _w.x) * t + Math.sin(i * 7.1) * 0.03 * t, _w.y + (a.y + 0.05 - _w.y) * t * t, _w.z + (a.z - _w.z) * t + Math.cos(i * 5.3) * 0.03 * t);
          drops.setMatrixAt(i, _dm);
        }
        drops.count = n; drops.instanceMatrix.needsUpdate = true;
        if (act.acc >= 0.12) {
          const step = Math.min(0.4, act.acc); act.acc = 0;
          const litres = Math.min(can, (0.5 + 2.2 * a.tip) * step);   // a rose pours up to about 2.5 L a second
          let res = cellAt(a.x, a.z) ? cmd('garden.water', { x: a.x, z: a.z, r: 0.42, litres }) : { ok: false };
          // off the beds: shrubs and trees from the nursery, and ponds, take it (src/sim/landscape.js)
          if (!res.ok && G.sim.handlers.has('landscape.water')) { const r2 = cmd('landscape.water', { x: a.x, z: a.z, litres }); if (r2.ok) res = r2; }
          G.burst(a.x, a.y + 0.08, a.z, 3 + Math.round(a.tip * 4), 0x9fd4f2, 0.9, 0.8, 0.04, 0.35);
          if (res.ok) { act.n++; tipEvent('watered'); }
        }
      } else if (drops.count) drops.count = 0;
    } else if (k === 'fill') {
      // at a pump: each push of the handle (drag down, let go) brings a gush; a tap or tank simply runs
      if (a.tip < 0.3) act.armed = true;
      else if (a.tip > 0.7 && act.armed && act.piece.category === 'pump') {
        act.armed = false;
        const room = 9 - S().can.litres;
        if (room < 0.05) say('The can is full.'); else drawFrom(act.piece, Math.min(3, room));
      }
    } else if (k === 'dip') {
      if (act.acc >= 0.15) { const step = act.acc; act.acc = 0; if (S().can.litres < 8.99) { const l = Math.min(6 * step, 9 - S().can.litres); cmd('garden.refill', { litres: l }); if (G.riverLive && streamAt(a.x, a.z)) G.riverLive.pour(2, a.x, a.z, 0.4, -l / 1000 / step); if (G.waterFx) G.waterFx.splash(a.x, waterY(a.x, a.z), a.z, 0.6); else G.burst(a.x, waterY(a.x, a.z) + 0.05, a.z, 3, 0xcfeaf7, 0.8, 0.6, 0.04, 0.4); } else if (!act.n) { act.n = 1; say('The can is full.'); } }
    } else if (k.startsWith('seed:')) sowAt(a, false);
    else if (k === 'hands') handsFrame(a);
    else if ((k === 'mulch' || k === 'compost') && act.acc >= 0.16) {
      act.acc = 0;
      if (!cellAt(a.x, a.z)) return;
      const sel = { x: a.x, z: a.z, r: 0.45 }, area = Math.PI * sel.r * sel.r;
      const res = k === 'mulch' ? cmd('garden.mulch', { ...sel, litres: area * 75 * 0.5 }) : cmd('garden.amend', { ...sel, kind: 'compost', litres: area * 20 * 0.5 });
      if (res.ok) G.burst(a.x, a.y + 0.6, a.z, 7, k === 'mulch' ? 0xe8c97a : 0x4a3324, 1.3, 0.4, 0.06, 0.6);
      else say(res.reason);
    }
  }
  function release(a) {
    const k = act.kind;
    drops.count = 0;
    if (k === 'shovel') { if (LS()) LS().tools.shovel.release(a); act.kind = ''; updateHint(true); return; }
    if (k === 'trowel') {
      act.kind = '';
      if (!act.drill) {
        const gx = Math.floor(a.x / CELL), gz = Math.floor(a.z / CELL), res = cmd('garden.open', { cells: [[gx, gz]], kind: 'hole' });
        if (!res.ok) say(res.reason);
        else if (res.cells) { G.burst(a.x, gy(a.x, a.z) + RAISE + 0.05, a.z, 8, 0x5a4230, 1.0, 1.6, 0.045, 0.45); tipEvent('opened'); }
      } else if (act.n) { say('Drew a drill ' + Math.round(act.n * 30) + ' cm long. Now drop the seed along it.'); tipEvent('opened'); }
      updateHint(true); return;
    }
    if (k === 'hoe' && act.hill) say('Drew soil up round the potatoes. Hilled ones make more tubers and none go green.');
    if (k === 'hoe' && act.n && a.travel < 0.2) say('Now drag the blade toward you: a long pull works a whole strip.');
    else if (k === 'can' && !act.n && a.held > 0.25 && S().can.litres > 0.01 && a.tip < 0.12) say('Drag the mouse down to tip the can (or hold the right button).');
    else if (k === 'fill' && act.piece && act.piece.category === 'pump' && S().can.litres < 8.9) say('Keep pumping: press again, or drag down and let go. ' + S().can.litres.toFixed(1) + ' of 9 L.');
    else if (k.startsWith('seed:') && act.n) { const c = k.slice(5); say('Sowed ' + act.n + ' ' + (act.n === 1 && CROPS[c].count === 1 ? CROPS[c].name.toLowerCase() : spanOf(c) > 1 || CROPS[c].count === 1 ? CROPS[c].plural : (act.n === 1 ? 'square' : 'squares') + ' of ' + CROPS[c].plural) + '. Water them in.'); tipEvent('sown'); }
    act.kind = ''; act.grab = null;
    updateHint(true);
  }

  /* ================= the name tag by the marker: what this is, and the one thing it needs ================= */
  const tag = label;
  let tagSig = '', tagX = -1, tagY = -1;
  const tagPt = { x: 0, y: 0, vis: false };
  function updateTag() {
    const a = H.aim, id = held();
    let txt = '', warn = false;
    if (a.valid && !a.down && !H.raising) {
      const c = cellAt(a.x, a.z), cell = c && c.bed.cells[c.i], p = cell && cell.pl && S().plants[cell.pl];
      if (p) { const s = read.plantStatus(G.sim.state, p.id); txt = CROPS[p.crop].name + ': ' + (s ? s.reason.split(/(?<=\.) /)[0] : ''); warn = !!s && /Thirsty|Hungry|Weedy|dry|Killed|Dried|Past|Bolted/.test(s.status); }
      else if (id.startsWith('seed:')) { if (!c) { txt = 'Grass: break the ground with the hoe first'; warn = true; } else if (tillOf(cell) < 1) { txt = 'Half worked: one more stroke of the hoe'; warn = true; } }
      else if (id === 'can' && owns('watering_can')) {
        const fx = fixtureNear(a.x, a.z);
        if (fx) txt = S().can.litres > 8.95 ? 'The can is full' : fx.category === 'pump' ? 'Hold the can here and pump: drag down, let go' : 'Hold the can here to fill it';
        else if (isPond(a.x, a.z)) txt = 'Hold to dip the can';
        else if (cell && tillOf(cell) >= 1) { const ci = read.cellInfo(G.sim.state, c.bed.id, c.i); txt = ci.water < 0.35 ? 'Dry soil' : ci.water > 0.8 ? 'Wet enough' : ''; warn = ci.water < 0.35; }
      } else if (id === 'hoe' && cell && tillOf(cell) >= 1 && cell.weed > 0.25) txt = 'Weeds: pull the hoe through them';
    }
    H.setMark(warn ? 0xf0b080 : 0xfff2c4, id === 'can' || id === 'mulch' || id === 'compost' ? 1.6 : id === 'hoe' ? 1.3 : 1);
    if (txt !== tagSig) { tagSig = txt; tag.textContent = txt; tag.hidden = !txt; tag.classList.toggle('warn', warn); tagX = -1; }
  }
  function moveTag() {
    if (tag.hidden) return;
    const a = H.aim; toScreen(a.x, a.y + 0.35, a.z, tagPt);
    const x = Math.round(tagPt.x + 18), y = Math.round(tagPt.y - 34);
    if (x !== tagX || y !== tagY) { tagX = x; tagY = y; tag.style.transform = 'translate(' + x + 'px,' + y + 'px)'; }
  }

  /* ================= harvest: it comes free, and the first of each crop is held up to admire ================= */
  const WORD = { pull: 'Pulled', pick: 'Picked', cut: 'Cut', dig: 'Dug', twist: 'Snapped off', reap: 'Reaped' };
  const fxPt = { x: 0, y: 0, vis: false };
  const trophies = new Map();
  function trophyOf(c) {
    let m = trophies.get(c);
    if (!m) { const g = geoFor(c, 'ready'); g.computeBoundingSphere(); m = new T.Mesh(g, toolMat); m.castShadow = true; m.userData.k = 0.34 / Math.max(0.05, g.boundingSphere.radius); trophies.set(c, m); }
    return m;
  }
  function flourish(res) {
    const byCrop = {};
    for (const pk of res.picks) (byCrop[pk.crop] || (byCrop[pk.crop] = [])).push(pk);
    let i = 0;
    for (const c in byCrop) {
      const kg = res.kg[c], pk = byCrop[c], n = pk.length * (CROPS[c].count > 1 ? CROPS[c].count : 1);
      const it = res.items && Object.entries(res.items).find(([id]) => id === ITEMS[read.produceOf(c)].id);
      for (const p of pk) {
        const b = S().field.groups[p.bed] || bedViews.get(p.bed)?.b; if (!b) continue;
        const span = spanOf(c), x = b.x0 + ((p.cell % b.nx) + span / 2) * CELL, z = b.z0 + (Math.floor(p.cell / b.nx) + span / 2) * CELL, y = gy(x, z) + 0.2;
        G.burst(x, y, z, 10, CROPS[c].col, 2.2, 3.2, 0.06, 0.8);
        if (CROPS[c].gesture === 'pull' || CROPS[c].gesture === 'dig') G.burst(x, y - 0.1, z, 6, 0x6b4f35, 1.4, 2.4, 0.06, 0.5);
      }
      // the first of each crop, and any big haul, is held up overhead for a beat; after that a quick lift, so a row stays quick
      const first = !tipState.got || !tipState.got[c], big = kg >= 1.5;
      if (first) { (tipState.got || (tipState.got = {}))[c] = true; saveTips(); }
      if (first || big || !H.raising) { const m = trophyOf(c); m.rotation.set(0, 0, 0); H.raise(m, first || big ? 1.35 : 0.42, m.userData.k); }
      const P = G.player;
      toScreen(P.x, P.y + (first || big ? 2.5 : 2.0), P.z, fxPt);
      const el = document.createElement('div');
      el.className = 'pop' + (first || big ? ' big' : ''); el.style.left = fxPt.x + 'px'; el.style.top = (fxPt.y - i * 34) + 'px';
      const what = CROPS[c].count > 1 && CROPS[c].gesture === 'pull' ? n + ' ' + CROPS[c].plural : CROPS[c].plural;
      el.innerHTML = esc(first ? (CROPS[c].count > 1 || /s$/.test(CROPS[c].plural) ? 'Your first ' + CROPS[c].plural + '!' : 'Your first ' + CROPS[c].name.toLowerCase() + '!') : WORD[CROPS[c].gesture] + ' ' + what) + '<small>+' + (kg < 1 ? Math.round(kg * 1000) + ' g' : kg.toFixed(1) + ' kg') + (it ? ' · ' + it[1] + ' for the kitchen' : ' into the stores') + '</small>';
      fxEl.appendChild(el); setTimeout(() => el.remove(), first || big ? 2300 : 1700);
      i++;
      tipEvent('harvest', c);
    }
  }

  /* ================= inspector card ================= */
  let cardFor = null, cardDetails = false;
  function inspectAt(g) {
    const c = cellAt(g.x, g.z);
    if (!c) { card.hidden = true; cardFor = null; return; }
    const pl = c.bed.cells[c.i].pl;
    cardFor = pl ? { plant: pl, bed: c.bed.id } : { bed: c.bed.id, cell: c.i };
    renderCard();
  }
  const dayText = (t) => { try { return read.dateOf(G.sim.state, t); } catch (e) { return ''; } };
  function renderCard() {
    if (!cardFor) return;
    const st = G.sim.state;
    let h = '';
    if (cardFor.plant && S().plants[cardFor.plant]) {
      const p = read.plantInfo(st, cardFor.plant, st.t), c = CROPS[p.crop];
      const cls = /Killed|Dried/.test(p.status) ? 'bad' : /Thirsty|Hungry|Weedy|Crowded|Shaded|Cold|Bolted|nipped|Past|dry|Waiting/.test(p.status) ? 'warn' : '';
      const span = Math.max(1, p.expectT - p.sownT), now = clamp((st.t - p.sownT) / span, 0, 1.2);
      const ahead = p.ahead > 0 ? p.ahead + ' days ahead of the packet' : p.ahead < 0 ? -p.ahead + ' days behind the packet' : 'on time';
      h += '<div class="row2"><h2>' + esc(p.name) + '<small>' + esc(p.variety) + (c.count > 1 ? ' · ' + c.count + ' plants' : '') + '</small></h2><button type="button" data-act="close" aria-label="Close">✕</button></div>';
      h += '<div><span class="st ' + cls + '">' + esc(p.status) + '.</span> ' + esc(p.reason) + '</div>';
      if (!p.dead) {
        h += '<div class="strip"><div class="bar"><i style="width:' + Math.round(clamp(p.progress, 0, 1) * 100) + '%"></i></div><div class="mk" style="left:' + Math.round(Math.min(1, now) * 100) + '%"></div>' +
          '<span class="lab" style="left:0">Sown ' + esc(dayText(p.sownT)) + '</span><span class="lab r">' + (p.readyT ? 'Ready ' : 'Harvest ~') + esc(dayText(p.expectT)) + '</span></div>';
        h += '<div style="font-size:13px;color:var(--ink-dim)">' + esc(p.stageWord) + ', ' + ahead + (p.yieldKg > 0.01 ? ' · about ' + (p.yieldKg < 1 ? Math.round(p.yieldKg * 1000) + ' g' : p.yieldKg.toFixed(1) + ' kg') + (p.harvest === 'repeat' ? ' ripe' : ' if harvested now') : '') + '</div>';
        h += '<div class="chips">' + p.needs.map((n) => '<span>' + esc(n) + '</span>').join('') + '</div>';
      }
      const rot = read.bedSummary(st, cardFor.bed);
      h += '<div class="row2"><button type="button" data-act="details">' + (cardDetails ? 'Hide details' : 'Details') + '</button>' + (p.dead ? '<button type="button" class="go" data-act="pull">Pull it</button>' : '') + '</div>';
      if (cardDetails) h += '<div class="det">' + Object.entries(p.details).map(([k, v]) => '<span>' + esc(k) + '</span><span>' + esc(v) + '</span>').join('') + '</div>';
    } else {
      const b = read.bedSummary(st, cardFor.bed);
      if (!b) { card.hidden = true; return; }
      const ci = read.cellInfo(st, cardFor.bed, cardFor.cell ?? 0);
      h += '<div class="row2"><h2>Bed<small>' + b.nx * 30 + ' × ' + b.nz * 30 + ' cm · ' + esc(b.soil) + '</small></h2><button type="button" data-act="close" aria-label="Close">✕</button></div>';
      h += '<div><span class="st' + (b.moistWord === 'Dry' ? ' warn' : '') + '">' + esc(b.moistWord) + '.</span> ' + esc(b.soilFeel) + '</div>';
      const words = [];
      if (b.weeds > 0.25) words.push('weeds are coming up');
      if (ci.mulch > 0.2) words.push('mulched with straw');
      if (b.cover) words.push('under a row cover');
      if (words.length) h += '<div>' + esc(words.join(', ').replace(/^./, (x) => x.toUpperCase())) + '.</div>';
      if (b.needs.length) h += '<div class="chips">' + b.needs.map((n) => '<span>Needs: ' + esc(n.toLowerCase()) + '</span>').join('') + '</div>';
      if (b.rotation) h += '<div style="font-size:13px;color:var(--ink-dim)">' + esc(b.rotation) + '</div>';
      const cr = Object.entries(b.crops).map(([c, n]) => n + ' × ' + CROPS[c].name.toLowerCase()).join(', ');
      h += '<div style="font-size:13px;color:var(--ink-dim)">' + (cr ? 'Growing: ' + esc(cr) : 'Nothing sown yet.') + '</div>';
      h += '<div class="row2"><button type="button" data-act="details">' + (cardDetails ? 'Hide details' : 'Details') + '</button><button type="button" data-act="cover">' + (b.cover ? 'Take the cover off' : 'Cover the bed') + '</button></div>';
      if (cardDetails) h += '<div class="det"><span>Water in the top 30 cm</span><span>' + Math.round(ci.water * 100) + '%</span><span>Nitrogen</span><span>' + ci.n.toFixed(1) + ' g/m²</span><span>Phosphorus</span><span>' + ci.p.toFixed(1) + ' g/m²</span><span>Potassium</span><span>' + ci.k.toFixed(1) + ' g/m²</span><span>pH</span><span>' + ci.ph.toFixed(1) + '</span><span>Organic matter</span><span>' + ci.om.toFixed(1) + '%</span><span>Weed cover</span><span>' + Math.round(ci.weed * 100) + '%</span></div>';
    }
    card.innerHTML = h; card.hidden = false;
  }
  card.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'close') { card.hidden = true; cardFor = null; }
    if (b.dataset.act === 'details') { cardDetails = !cardDetails; renderCard(); }
    if (b.dataset.act === 'pull' && cardFor && cardFor.plant) { cmd('garden.pull', { bed: cardFor.bed, cells: [S().plants[cardFor.plant].cell] }); card.hidden = true; cardFor = null; }
    if (b.dataset.act === 'cover' && cardFor) { cmd('garden.cover', { bed: cardFor.bed }); renderCard(); }
    canvas.focus();
  });

  /* ================= the almanac ================= */
  function toggleAlmanac(force) {
    alm.hidden = force !== undefined ? !force : !alm.hidden;
    if (!alm.hidden) renderAlmanac();
  }
  let almSig = '';
  function renderAlmanac() {
    const st = G.sim.state, a = read.almanac(st);
    const name = (c) => CROPS[c].name;
    let h = '<h2>Almanac<button type="button" data-act="close" aria-label="Close">✕</button></h2>';
    h += '<div>Today is ' + esc(a.today) + '. ' + (a.frostFree ? 'Frost is rare here.' : 'The last spring frost is usually in <b>' + esc(a.lastFrost) + '</b>, the first autumn frost in <b>' + esc(a.firstFrost) + '</b>.') + (life() > 1.01 ? ' <small>(A year here is ' + st.yearDays + ' days, so the seasons pass quickly.)</small>' : '') + '</div>';
    h += '<div class="frost ' + a.frost.level + '">' + esc(a.frost.text) + (a.frost.atRisk.length ? ' At risk: ' + esc(a.frost.atRisk.map(name).join(', ').toLowerCase()) + '.' : '') + (a.frost.level !== 'none' && Object.keys(S().field.groups).length ? ' <button type="button" class="go" data-act="cover">' + (Object.values(S().field.groups).every((b) => b.cover) ? 'Uncover the beds' : 'Cover the beds') + '</button>' : '') + '</div>';
    h += '<h3>Sow now</h3>' + (a.sowNow.length ? '<ul>' + a.sowNow.map((s) => '<li>' + esc(name(s.crop)) + ' <small>until ' + esc(s.until) + (life() > 1.01 && s.gameDaysLeft != null ? ' (' + s.gameDaysLeft + ' game days)' : '') + '</small></li>').join('') + '</ul>' : '<div>Nothing: it is the wrong time of year. ' + (a.sowSoon.length ? '' : 'Plan for spring.') + '</div>');
    if (a.sowSoon.length) h += '<h3>Soon</h3><ul>' + a.sowSoon.map((s) => '<li>' + esc(name(s.crop)) + ' <small>from ' + esc(s.from) + '</small></li>').join('') + '</ul>';
    h += '<h3>Ready</h3>' + (a.readySoon.length ? '<ul>' + a.readySoon.map((r) => '<li>' + esc(name(r.crop)) + (r.plants > 1 ? ' ×' + r.plants : '') + ' <small>' + (r.now ? 'ready now' : r.inDays <= 0 ? 'any day now' : 'in about ' + r.inDays + ' days') + '</small></li>').join('') + '</ul>' : '<div>Nothing ready yet.</div>');
    if (h !== almSig) { almSig = h; alm.innerHTML = h; }
  }
  alm.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'close') toggleAlmanac(false);
    if (b.dataset.act === 'cover') { const all = Object.values(S().field.groups).every((x) => x.cover); cmd('garden.cover', { on: !all }); renderAlmanac(); }
    canvas.focus();
  });

  /* ================= the first salad: a guided project, optional and skippable ================= */
  const PROJECT = { id: 'salad', title: 'Grow your first salad', blurb: 'Press 5 for the Garden. Work a small patch with the hoe, sow radish and lettuce, water them, and eat them in about four weeks.' };
  const TIPS = {
    start: { h: 'Grow your first salad', b: 'Hold the Hoe (2). Press the blade into the grass and drag it toward you; go over each strip again until it is fine, dark soil. A patch about 1.2 by 1 metre is plenty.', why: 'Turning the sod gives the seeds loose soil without grass roots to fight.' },
    sow: { h: 'Sow radish and lettuce', b: 'Take the trowel and drag its tip along the row: that draws a drill, a shallow groove for the seed. Then take the radish packet from the Seed box and drag along the drill. Do the same with lettuce.', why: 'Radishes are ready in about four weeks, leaf lettuce in about six. Both like the cool spring.' },
    water: { h: 'Water them in', b: 'Hold the Can (3). Hold the button to lift it, drag down to tip it, and walk along the row. Fill your can at the pump by the well: hold it under the spout and pump the handle.', why: 'Seeds only sprout in moist soil. Dry soil is pale, wet soil dark: water again when it looks pale, not every day.' },
    wait: { h: 'Now let them grow', b: 'Speed up time with the clock buttons if you like. Point at a plant to see how it is doing; F looks closer.', why: 'Plants grow on warmth and light: a cool week is slower than a warm one.' },
    harvest: { h: 'Your first radishes!', b: 'Hold Hands (1). Press on a radish and pull upward until it comes free. Lettuce is cut with a sideways swipe.', why: 'Leave them too long and they turn woody, so pull them when ready.' },
  };
  const tipKey = () => 'homestead:gardentips:' + G.seed;
  let tipState = (() => { try { return JSON.parse(localStorage.getItem(tipKey()) || '{}'); } catch (e) { return {}; } })();
  const saveTips = () => { try { localStorage.setItem(tipKey(), JSON.stringify(tipState)); } catch (e) { /* private mode */ } };
  function ensureProject() {
    const pr = stock().projects;
    if (!pr.some((p) => p.id === PROJECT.id)) cmd('projects.add', PROJECT);
  }
  const projectOpen = () => { const p = stock().projects.find((x) => x.id === PROJECT.id); return p && p.status === 'open'; };
  function showTip(id) {
    if (tipState.off || tipState[id] || !projectOpen()) { tip.hidden = true; return; }
    const t = TIPS[id];
    tip.dataset.id = id;
    tip.innerHTML = '<h3>' + esc(t.h) + '</h3><div>' + esc(t.b) + '</div><div class="why">' + esc(t.why) + '</div><div class="acts"><button type="button" data-act="skip">Skip the guide</button><button type="button" class="go" data-act="ok">Got it</button></div>';
    tip.hidden = false;
  }
  tip.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'skip') { tipState.off = true; saveTips(); cmd('projects.dismiss', { id: PROJECT.id }); }
    else { tipState[tip.dataset.id] = true; saveTips(); }
    tip.hidden = true; canvas.focus();
  });
  function tipEvent(ev, c) {
    if (ev === 'bed') { if (!tipState.start) { tipState.start = true; showTip('sow'); } }
    else if (ev === 'sown') { if (!tipState.sown) { tipState.sown = true; showTip('water'); } }
    else if (ev === 'watered') { if (tip.dataset.id === 'water' && !tip.hidden) { tipState.water = true; saveTips(); showTip('wait'); } return; }
    else if (ev === 'harvest' && (c === 'radish' || c === 'lettuce')) {
      const got = S().totals.harvestKg;
      if (got.radish > 0 && got.lettuce > 0 && projectOpen()) { cmd('projects.done', { id: PROJECT.id }); say('Your first salad: radishes and lettuce from your own garden.', 5); tip.hidden = true; }
    }
    saveTips();
  }
  function tipsTick() {
    // the harvest card appears when something first becomes ready
    if (!tip.hidden || tipState.off || tipState.harvest || !projectOpen()) return;
    for (const p of Object.values(S().plants)) if ((p.crop === 'radish' || p.crop === 'lettuce') && p.readyT != null && !p.dead) { showTip('harvest'); tipState.harvest = true; saveTips(); return; }
  }

  /* ================= taking up the garden tools, and putting them away ================= */
  let lastHeld = 'hoe';
  function enter() {
    sayTo = null;
    on = true; document.body.classList.add('gardening'); bar.hidden = false;
    const r = findRing(); if (r) r.scale.setScalar(0);
    ensureProject(); findSources();
    const anyBed = Object.keys(S().field.groups).length > 0;
    H.open({ bar: toolsEl, reach: 1.5, camDist: 7.5, pace: 0.5, tipPx: 90, liftPx: 70, slots: slotList(), held: anyBed ? lastHeld : 'hoe', onHold, press, frame: frameAct, release, alt: (cur) => !!cur && cur.id === 'shovel' });
    onHold(held());
    if (!anyBed && !tipState.start) showTip('start');
  }
  function leave() {
    lastHeld = held() === 'box' ? 'hands' : held();
    on = false; document.body.classList.remove('gardening'); bar.hidden = true; tip.hidden = true;
    H.close();
    const r = findRing(); if (r) r.scale.setScalar(1);
    tag.hidden = true; tagSig = ''; dots.count = 0; drops.count = 0;
  }
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (G.player.tool === 'build') return;                     // build mode has first refusal while open
    if (e.code === 'Digit5' && !e.repeat) { G.setTool(G.player.tool === 'garden' ? 'axe' : 'garden'); e.preventDefault(); }
    else if (e.code === 'KeyN' && !e.repeat) { toggleAlmanac(); e.preventDefault(); }
    else if (e.code === 'KeyF' && !e.repeat && on && H.aim.valid) { inspectAt(H.aim); e.preventDefault(); }
    else if (e.code === 'Escape') { if (!card.hidden) { card.hidden = true; cardFor = null; } else if (!alm.hidden) toggleAlmanac(false); else if (on) G.setTool('axe'); }
  });

  /* ================= every frame (cheap) and four times a second (the garden's look) ================= */
  let last = performance.now(), slow = 0, bedSig = '', srcT = 0;
  function frame(t) {
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    const want = G.player.tool === 'garden';
    if (want !== on) { if (want) enter(); else leave(); }
    if (on) moveTag();
    slow += dt;
    if (slow > 0.25 || dirty) { slow = 0; refresh(); dirty = false; }
    requestAnimationFrame(frame);
  }
  function refresh() {
    const s = S(), ids = Object.keys(s.field.groups);
    let sig = '';
    for (const id of ids) sig += id + '@' + dimOf(s.field.groups[id]) + ',';
    if (sig !== bedSig) {
      for (const [id, v] of [...bedViews]) if (!s.field.groups[id] || dimOf(s.field.groups[id]) !== v.dim) dropBed(id);
      for (const id of ids) if (!bedViews.has(id)) buildBed(s.field.groups[id]);
      bedSig = sig; plantSig = ''; weedSig = ''; hideGrass(true);
    }
    for (const v of bedViews.values()) { v.b = s.field.groups[v.b.id] || v.b; paintBed(v); }
    if (ids.length) hideGrass();
    const ps = plantSignature();
    if (ps !== plantSig) { plantSig = ps; layoutPlants(); }
    layoutWeeds();
    if (on) {
      if ((srcT += 1) % 12 === 0) findSources();
      H.setSlots(slotList()); updateHint(); updateTag(); tipsTick();
    }
    if (!alm.hidden) renderAlmanac();
    if (cardFor && !card.hidden && (G.sim.ticksLastAdvance || dirty)) renderCard();
  }
  G.sim.listen((type) => { if (type === 'loaded') { bedSig = ''; plantSig = ''; weedSig = ''; for (const v of bedViews.values()) v.sig.fill(-1); dirty = true; } });
  requestAnimationFrame(frame);

  // test hooks
  window.__gardenView = {
    get on() { return on; }, get held() { return held(); }, hold: (id) => H.hold(id), choose: (c) => { crop = c; H.setSlots(slotList()); return H.hold('seed:' + c); },
    groundAt: (nx, ny) => { const o = {}; return H.groundAt(nx, ny, o) ? o : null; }, toScreen: (x, y, z) => toScreen(x, y, z, {}),
    meshes: () => [...meshes.entries()].map(([k, m]) => [k, m.count]), beds: () => [...bedViews.keys()], almanac: toggleAlmanac,
    inspect: (x, z) => inspectAt({ x, z }), get firsts() { return tipState.got || {}; }, refresh: () => { dirty = true; refresh(); }, source,
    // the can, lent to the Yard (src/landscape-view.js): its gestures, its model, and where its messages go
    can: { item: ITEMSHOW.can, press: (a) => press(a), frame: (a, dt) => frameAct(a, dt), release: (a) => release(a) }, bindSay: (fn) => { sayTo = fn; },
  };
})();
