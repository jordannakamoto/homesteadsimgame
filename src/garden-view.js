/* Garden view: the Garden tool (key 5), beds you draw on the ground, plants that grow in them, watering,
   harvest, the plant inspector, the almanac (N) and the "Grow your first salad" cards.
   Draws the simulation's garden (sim.state.sys.garden) and owns no truth of its own: every action is a
   garden.* command. Reaches the game only through window.__game.
   Cost: nothing per frame unless something moves on screen; soil colours and plant instances are rebuilt only
   when a cell or plant changes visibly (checked four times a second, cheaply). */
(() => {
  const G = window.__game;
  if (!G || !G.sim || !G.sim.handlers.has('garden.makeBed')) return;
  const T = G.THREE, $ = (id) => document.getElementById(id), canvas = $('view');
  const bar = $('gbar'), hint = bar.querySelector('.ghint'), toolsEl = bar.querySelector('.gtools'), seedsEl = bar.querySelector('.gseeds');
  const label = $('glabel'), prog = $('gprog'), progArc = $('gprogarc'), fxEl = $('gfx'), card = $('gcard'), alm = $('galm'), tip = $('gtip');
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
  const spanOf = (id) => (CROPS[id].spacing > CELL + 1e-9 ? Math.round(CROPS[id].spacing / CELL) : 1);
  const read = G.garden;   // the garden's read-outs (almanac, plantInfo, cellInfo...), from the simulation
  if (!read) return;

  /* ================= icons (inline SVG, drawn for this palette) ================= */
  const I = (body) => '<svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="#f1ead6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  const ICONS = {
    bed: I('<path d="M6 28l8-12h18l-6 12z" fill="#7a5638" stroke="#e8c79a"/><path d="M10 25h14M13 21h14" stroke="#c99a6a" stroke-width="1.6"/><path d="M30 6v13" stroke="#cfd6dc" stroke-width="2.4"/><path d="M27 19h6l-1 6h-4z" fill="#b9c2c9" stroke="#cfd6dc"/>'),
    sow: I('<path d="M8 30c6-2 18-2 24 0" stroke="#c99a6a"/><circle cx="14" cy="26" r="1.8" fill="#f2dfa0" stroke="none"/><circle cx="20" cy="25" r="1.8" fill="#f2dfa0" stroke="none"/><circle cx="26" cy="26" r="1.8" fill="#f2dfa0" stroke="none"/><path d="M20 21c0-6 3-9 8-10-1 5-4 8-8 10zM20 21c0-4-2-7-6-8 0 4 2 7 6 8z" fill="#8cc35a" stroke="#cfe3a6" stroke-width="1.4"/>'),
    water: I('<path d="M8 17h16v13a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z" fill="#5f8fb0" stroke="#bfe2f7"/><path d="M24 20l9-7" stroke="#bfe2f7"/><path d="M33 13l2-2" stroke="#bfe2f7" stroke-width="3"/><path d="M12 17c0-4 2-6 4-6s4 2 4 6" stroke="#bfe2f7"/><path d="M35 18v3M32 22v3M36 24v3" stroke="#8fd0f2" stroke-width="1.8"/>'),
    hoe: I('<path d="M28 6L14 30" stroke="#d8b585" stroke-width="2.6"/><path d="M10 27l7 5-3 3-7-4z" fill="#b9c2c9" stroke="#cfd6dc"/><path d="M26 30c2-3 5-4 8-3M22 34c2-2 4-3 7-3" stroke="#8cc35a" stroke-width="1.6"/>'),
    harvest: I('<path d="M9 18h22l-3 14H12z" fill="#a8743f" stroke="#e8c79a"/><path d="M9 18c3-6 19-6 22 0" stroke="#e8c79a"/><circle cx="16" cy="16" r="3.2" fill="#d8402c" stroke="none"/><circle cx="23" cy="15" r="3.2" fill="#e8822e" stroke="none"/><path d="M21 12c1-3 3-4 5-4" stroke="#8cc35a" stroke-width="1.6"/>'),
    inspect: I('<circle cx="17" cy="17" r="9" fill="rgba(191,226,247,0.15)" stroke="#f1ead6"/><path d="M24 24l9 9" stroke-width="3"/><path d="M17 22c0-4 2-6 5-7-1 4-3 6-5 7z" fill="#8cc35a" stroke="none"/>'),
    mulch: I('<path d="M6 30c8-4 20-4 28 0" stroke="#e8c97a" stroke-width="3"/><path d="M8 27l6-5M14 28l5-7M20 27l6-6M26 28l5-5M11 24l-3-4M23 24l2-5" stroke="#e8c97a" stroke-width="1.6"/>'),
    compost: I('<path d="M8 32l4-14h16l4 14z" fill="#5a3d26" stroke="#c99a6a"/><path d="M12 18c2-4 14-4 16 0" stroke="#c99a6a"/><path d="M15 26h2M22 24h2M19 29h2" stroke="#9b7a52" stroke-width="2"/><path d="M27 12c2-2 5-2 6 0" stroke="#8cc35a" stroke-width="1.6"/>'),
    almanac: I('<path d="M9 7h18a4 4 0 0 1 4 4v22H13a4 4 0 0 1-4-4z" fill="#3c4a4e" stroke="#e8c79a"/><path d="M13 13h13M13 18h13M13 23h8" stroke="#e8c79a" stroke-width="1.6"/><circle cx="27" cy="26" r="4" fill="#e2b65a" stroke="none"/>'),
  };
  const TOOLS = [
    { id: 'bed', name: 'Bed' }, { id: 'sow', name: 'Sow' }, { id: 'water', name: 'Water' }, { id: 'hoe', name: 'Hoe' },
    { id: 'harvest', name: 'Harvest' }, { id: 'inspect', name: 'Inspect' }, { id: 'mulch', name: 'Mulch' }, { id: 'compost', name: 'Compost' },
    { id: 'almanac', name: 'Almanac' },
  ];
  toolsEl.innerHTML = TOOLS.map((t) => '<button type="button" data-g="' + t.id + '" aria-pressed="false" title="' + t.name + (t.id === 'almanac' ? ' (N)' : '') + '">' + ICONS[t.id] + '<span>' + t.name + '</span></button>').join('');

  /* ================= state of the view ================= */
  let on = false, tool = 'bed', crop = 'radish', dirty = true, hintSig = '';
  const ptr = { x: 0, y: 0, ndcX: 0, ndcY: 0, down: false, btn: -1, rx: 0, ry: 0, inside: false, ground: null };
  let drag = null;            // { a: {x,z}, b: {x,z} } while drawing a bed or sowing a block
  let marked = null;          // a bed marked out and waiting to be dug: { x0, z0, nx, nz, done (0..1) }
  let acting = 0;             // seconds since the last swathe command while holding a tool
  const flash = { msg: '', until: 0 };

  /* ================= ground picking ================= */
  const ray = new T.Raycaster(), v2 = new T.Vector2();
  function groundAt(nx, ny, out) {
    v2.set(nx, ny); ray.setFromCamera(v2, G.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    let t = 0, prev = 0;
    for (let i = 0; i < 200 && t < 140; i++) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t, h = G.heightAt(x, z);
      if (y < h) {
        let a = prev, b = t;
        for (let k = 0; k < 10; k++) { const m = (a + b) / 2; if (o.y + d.y * m < G.heightAt(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
        out.x = o.x + d.x * b; out.z = o.z + d.z * b; out.y = G.heightAt(out.x, out.z);
        return out;
      }
      prev = t; t += Math.max(0.15, (y - h) * 0.5);
    }
    return null;
  }
  const gp = { x: 0, y: 0, z: 0 };
  const snap = (v) => Math.round(v / CELL) * CELL;
  function cellAt(x, z) {
    for (const b of Object.values(S().field.groups)) {
      const ix = Math.floor((x - b.x0) / CELL), iz = Math.floor((z - b.z0) / CELL);
      if (ix >= 0 && iz >= 0 && ix < b.nx && iz < b.nz) return { bed: b, i: iz * b.nx + ix, ix, iz };
    }
    return null;
  }
  function toScreen(x, y, z, out) {
    const v = toScreen.v || (toScreen.v = new T.Vector3());
    v.set(x, y, z).project(G.camera);
    out.x = (v.x * 0.5 + 0.5) * innerWidth; out.y = (-v.y * 0.5 + 0.5) * innerHeight; out.vis = v.z < 1;
    return out;
  }

  /* ================= the soil: one mesh per bed, coloured by moisture, mulch and weeds ================= */
  const soilMat = new T.MeshLambertMaterial({ vertexColors: true });
  const sideMat = new T.MeshLambertMaterial({ color: 0x4a3324 });
  const coverMat = new T.MeshLambertMaterial({ color: 0xf4f2ea, transparent: true, opacity: 0.45, side: T.DoubleSide, depthWrite: false });
  const bedViews = new Map();   // bed id -> { group, soil, colors, sig: Float32Array, x0, z0, nx, nz, cover }
  const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const SOIL_DRY = new T.Color(0x9c7b58), SOIL_WET = new T.Color(0x3d2a1c), STRAW = new T.Color(0xcdb176), WEEDY = new T.Color(0x56703a), _c = new T.Color();
  const RAISE = 0.05;
  function buildBed(b) {
    const g = new T.Group();
    const n = b.nx * b.nz, pos = new Float32Array(n * 6 * 3), col = new Float32Array(n * 6 * 3);
    const H = (x, z) => G.heightAt(x, z) + RAISE;
    let k = 0;
    for (let iz = 0; iz < b.nz; iz++) for (let ix = 0; ix < b.nx; ix++) {
      const x0 = b.x0 + ix * CELL, z0 = b.z0 + iz * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
      // a little tilth: each corner a centimetre up or down, so the bed is not a flat card
      const j = (x, z) => H(x, z) + (hash(Math.round(x * 100), Math.round(z * 100)) - 0.5) * 0.025;
      const q = [[x0, z0], [x0, z1], [x1, z0], [x1, z0], [x0, z1], [x1, z1]];
      for (const [x, z] of q) { pos[k++] = x; pos[k++] = j(x, z); pos[k++] = z; }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const soil = new T.Mesh(geo, soilMat);
    soil.receiveShadow = true;
    g.add(soil);
    // the sides of the raised bed, down into the ground
    const side = [], W = b.nx * CELL, D = b.nz * CELL, seg = (ax, az, bx, bz, steps) => {
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps, t1 = (s + 1) / steps, xa = lerp(ax, bx, t0), za = lerp(az, bz, t0), xb = lerp(ax, bx, t1), zb = lerp(az, bz, t1);
        const ya = H(xa, za), yb = H(xb, zb);
        side.push(xa, ya, za, xa, ya - 0.14, za, xb, yb, zb, xb, yb, zb, xa, ya - 0.14, za, xb, yb - 0.14, zb);
      }
    };
    seg(b.x0, b.z0, b.x0 + W, b.z0, b.nx); seg(b.x0 + W, b.z0, b.x0 + W, b.z0 + D, b.nz); seg(b.x0 + W, b.z0 + D, b.x0, b.z0 + D, b.nx); seg(b.x0, b.z0 + D, b.x0, b.z0, b.nz);
    const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(new Float32Array(side), 3)); sg.computeVertexNormals();
    const sm = new T.Mesh(sg, new T.MeshLambertMaterial({ color: 0x4a3324, side: T.DoubleSide })); g.add(sm);
    G.scene.add(g);
    const v = { group: g, soil, geo, col, sig: new Float32Array(n).fill(-1), b, cover: null };
    bedViews.set(b.id, v);
    hideGrass();
    return v;
  }
  function paintBed(v) {
    const b = S().field.groups[v.b.id] || v.b, info = read.cellInfo;
    let changed = false;
    for (let i = 0; i < b.cells.length; i++) {
      const c = b.cells[i], ci = info(G.sim.state, b.id, i);
      const wet = clamp(ci.water, 0, 1), s = Math.round(wet * 40) + Math.round(ci.mulch * 10) * 64 + Math.round(ci.weed * 10) * 1024;
      if (v.sig[i] === s) continue;
      v.sig[i] = s; changed = true;
      _c.copy(SOIL_DRY).lerp(SOIL_WET, Math.pow(wet, 0.8)).lerp(STRAW, ci.mulch * 0.85).lerp(WEEDY, ci.weed * 0.35);
      for (let k = 0; k < 6; k++) {
        const n = 0.92 + 0.14 * hash(i * 7 + k, b.nx);
        v.col[(i * 6 + k) * 3] = _c.r * n; v.col[(i * 6 + k) * 3 + 1] = _c.g * n; v.col[(i * 6 + k) * 3 + 2] = _c.b * n;
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
      m.rotation.set(0, 0, 0);
      if (along) m.rotation.z = Math.PI / 2; else m.rotation.x = Math.PI / 2;
      m.rotation.order = 'XYZ';
      const y = G.heightAt(b.x0 + W / 2, b.z0 + D / 2) + RAISE;
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
    hideGrass(true);
  }

  /* ---- grass inside beds: the engine's tufts are hidden where a bed lies (re-applied when a chunk redraws) ---- */
  const grassSeen = new WeakMap();
  const ZERO = new T.Matrix4().makeScale(0, 0, 0);
  function hideGrass(force) {
    const beds = Object.values(S().field.groups);
    const chunks = G.world && G.world.chunks;
    if (!chunks) return;
    for (const c of chunks.values()) {
      for (const [mesh, list] of [[c.grassMesh, c.grass], [c.flowerMesh, c.flowers]]) {
        if (!mesh || !list) continue;
        const ver = mesh.instanceMatrix.version;
        if (!force && grassSeen.get(mesh) === ver) continue;
        let n = 0;
        if (beds.length) list.forEach((g, i) => {
          const x = c.ox + g.lx, z = c.oz + g.lz;
          for (const b of beds) if (x > b.x0 - 0.15 && x < b.x0 + b.nx * CELL + 0.15 && z > b.z0 - 0.15 && z < b.z0 + b.nz * CELL + 0.15) { mesh.setMatrixAt(i, ZERO); n++; break; }
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
      if (h > 1.2) p.push(part(cone(0.22, 0.05, 5), 0xd8c37a, 0, h, 0));   // the tassel
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
  const geoFor = (c, st) => { const k = c + ':' + st; let g = geoCache.get(k); if (!g) { g = (LOOK[c] || LOOK.lettuce)(st); geoCache.set(k, g); } return g; };
  const meshes = new Map();    // key -> InstancedMesh
  const VIS_STAGE = { sown: null, seedling: 'seedling', leafy: 'leafy', flowering: 'flowering', fruiting: 'fruiting', ready: 'ready', past: 'past' };
  // which look each crop has for each stage (crops without a flower or fruit look keep their leafy or ready look)
  const looksOf = { radish: ['seedling', 'leafy', 'ready', 'past', 'flowering'], lettuce: ['seedling', 'leafy', 'ready', 'past', 'flowering'], carrot: ['seedling', 'leafy', 'ready', 'past'],
    kale: ['seedling', 'leafy', 'ready', 'past'], garlic: ['seedling', 'leafy', 'ready', 'past'] };
  function lookStage(c, st, p) {
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
          const y = G.heightAt(cx, cz) + RAISE;
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
    let sig = '';
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
      const w = b.cells[i].weed, k = w > 0.7 ? 3 : w > 0.4 ? 2 : w > 0.15 ? 1 : 0;
      sig += k;
      for (let j = 0; j < k; j++) {
        const x = b.x0 + ((i % b.nx) + 0.15 + 0.7 * hash(i * 5 + j, 21)) * CELL, z = b.z0 + (Math.floor(i / b.nx) + 0.15 + 0.7 * hash(i * 3 + j, 23)) * CELL;
        const sc = 0.7 + 0.6 * hash(i + j, 2) + w * 0.5;
        _m.compose(_p.set(x, G.heightAt(x, z) + RAISE, z), _q.setFromEuler(_e.set(0, hash(i, j) * 6.28, 0)), _s.set(sc, sc, sc));
        weedMesh.setMatrixAt(n++, _m);
      }
    }
    if (sig === weedSig) return;
    weedSig = sig; weedMesh.count = n; weedMesh.instanceMatrix.needsUpdate = true;
  }

  /* ================= ghosts: the bed being drawn, the sowing spacing, the brush ================= */
  const ghostMat = new T.MeshBasicMaterial({ color: 0xfff2c4, transparent: true, opacity: 0.35, depthWrite: false });
  const lineMat = new T.LineBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.9, depthTest: false });
  const outline = new T.Line(new T.BufferGeometry(), lineMat); outline.renderOrder = 11; outline.visible = false; outline.frustumCulled = false; G.scene.add(outline);
  const markedLine = new T.Line(new T.BufferGeometry(), new T.LineDashedMaterial({ color: 0xffe6a0, dashSize: 0.15, gapSize: 0.1, depthTest: false, transparent: true })); markedLine.renderOrder = 11; markedLine.visible = false; markedLine.frustumCulled = false; G.scene.add(markedLine);
  function rectLine(line, x0, z0, x1, z1, dashed) {
    const pts = [], n = 8;
    const edge = (ax, az, bx, bz) => { for (let i = 0; i <= n; i++) { const x = lerp(ax, bx, i / n), z = lerp(az, bz, i / n); pts.push(x, G.heightAt(x, z) + 0.08, z); } };
    edge(x0, z0, x1, z0); edge(x1, z0, x1, z1); edge(x1, z1, x0, z1); edge(x0, z1, x0, z0);
    line.geometry.dispose(); line.geometry = new T.BufferGeometry(); line.geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(pts), 3));
    if (dashed) line.computeLineDistances();
    line.visible = true;
  }
  const dotGeo = new T.CircleGeometry(0.025, 8); dotGeo.rotateX(-Math.PI / 2);
  const dots = new T.InstancedMesh(dotGeo, new T.MeshBasicMaterial({ color: 0xfff2c4, transparent: true, opacity: 0.8, depthWrite: false }), 1600);
  dots.count = 0; dots.renderOrder = 10; dots.frustumCulled = false; G.scene.add(dots);
  const brushRing = new T.Mesh(new T.RingGeometry(0.4, 0.44, 32), new T.MeshBasicMaterial({ color: 0xfff2c4, transparent: true, opacity: 0.8, depthTest: false }));
  brushRing.rotation.x = -Math.PI / 2; brushRing.renderOrder = 11; brushRing.visible = false; G.scene.add(brushRing);
  const BRUSH = { water: 0.45, hoe: 0.35, harvest: 0.3, mulch: 0.45, compost: 0.45 };

  // the engine's terrain-brush ring is meant for the Dig and Raise tools: hide it while gardening
  let engineRing = null;
  const findRing = () => engineRing || (engineRing = G.scene.children.find((o) => o.isMesh && o.geometry && o.geometry.type === 'RingGeometry' && o.geometry.parameters.innerRadius === 2.45) || null);

  /* ================= the palette, seed cards and hints ================= */
  function setGTool(id) {
    if (id === 'almanac') { toggleAlmanac(); return; }
    tool = id; drag = null; dirty = true;
    for (const b of toolsEl.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.g === id));
    seedsEl.hidden = id !== 'sow';
    if (id === 'sow') renderSeeds();
    if (id !== 'inspect') card.hidden = card.hidden || false;
    updateHint(true);
  }
  toolsEl.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { setGTool(b.dataset.g); canvas.focus(); } });
  const money = (v) => '$' + (Math.round(v * 100) / 100).toFixed(v % 1 ? 2 : 0);
  function sowWord(c) {
    try { return read.sowAdvice(c, G.sim.state.sys.weather.site, read.doy(G.sim.state), life()); } catch (e) { return null; }
  }
  function renderSeeds() {
    let h = '';
    for (const c of CROP_IDS) {
      const it = ITEMS[CROPS[c].seed], own = have(it.id) + ((S().packets[c] || 0) > 0 ? 1e-6 : 0), adv = sowWord(c);
      const ownTxt = it.unit === 'kg' ? (Math.round(have(it.id) * 10) / 10) + ' kg' : String(Math.floor(have(it.id)));
      const open = S().packets[c] > 0 ? ' + open' : '';
      h += '<button type="button" class="gseed" data-crop="' + c + '" aria-pressed="' + (c === crop) + '"><b>' + esc(CROPS[c].name) + '<i style="background:#' + CROPS[c].col.toString(16).padStart(6, '0') + '"></i></b>' +
        '<span class="when' + (adv && adv.now ? '' : ' no') + '">' + esc(adv ? adv.short : '') + '</span>' +
        '<span>' + (CROPS[c].spacing >= 0.3 ? Math.round(CROPS[c].spacing * 100) + ' cm apart' : CROPS[c].count + ' to a 30 cm square') + '</span>' +
        (own > 0 ? '<span class="own">You have ' + ownTxt + open + '</span>' : '<span>Buy for ' + money(it.priceUsd) + (it.unit === 'kg' ? ' a kg' : '') + '</span>') + '</button>';
    }
    seedsEl.innerHTML = h;
  }
  seedsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.gseed'); if (!b) return;
    crop = b.dataset.crop;
    const it = ITEMS[CROPS[crop].seed];
    if (have(it.id) <= 0 && !(S().packets[crop] > 0)) {
      const r = cmd('stock.buy', { id: it.id, qty: 1 });
      say(r.ok ? 'Bought ' + it.name.toLowerCase() + '.' : 'Not enough money for ' + it.name.toLowerCase() + '.');
    }
    renderSeeds(); updateHint(true); canvas.focus();
  });
  function say(msg, secs = 3) { flash.msg = msg; flash.until = performance.now() + secs * 1000; updateHint(true); }
  function buyButton(id, label) { return ' <button type="button" class="go" data-buy="' + id + '">' + esc(label) + ' ' + money(ITEMS[id].priceUsd) + '</button>'; }
  hint.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.buy) { const r = cmd('stock.buy', { id: b.dataset.buy, qty: ITEMS[b.dataset.buy].unit === 'L' ? (b.dataset.buy === 'mulch_straw' ? 150 : 40) : 1 }); say(r.ok ? 'Bought.' : 'Not enough money.'); if (b.dataset.buy === 'watering_can' && r.ok) cmd('garden.refill', {}); }
    if (b.dataset.act === 'refill') { cmd('garden.refill', {}); say('Filled the can: 9 litres.'); }
    if (b.dataset.act === 'cover') { const r = cmd('garden.cover', {}); say(r.ok ? (r.on ? 'The beds are under fleece.' : 'Covers off.') : r.reason); }
    updateHint(true); canvas.focus();
  });
  function updateHint(force) {
    const s = S(), can = s.can.litres;
    let h;
    const now = performance.now();
    if (flash.until > now) h = esc(flash.msg);
    else if (tool === 'bed') {
      const spade = owns('spade') || owns('shovel');
      if (!spade) h = 'You need a spade to turn the sod.' + buyButton('spade', 'Buy a spade');
      else if (marked) h = '<b>Hold</b> on the marked bed to dig it' + (owns('spade') ? '.' : ' (a spade is quicker than the shovel).') ;
      else h = '<b>Drag</b> on the grass to mark out a bed. Small is good to start: about 1.2 by 1 m.';
    } else if (tool === 'sow') {
      const it = ITEMS[CROPS[crop].seed];
      h = (have(it.id) > 0 || s.packets[crop] > 0) ? '<b>Click</b> a bed square to sow ' + esc(CROPS[crop].plural) + ', or <b>drag</b> to sow a row or block. The dots show the spacing.' : 'Choose a seed packet above to buy it.';
    } else if (tool === 'water') {
      if (!owns('watering_can')) h = 'You need a watering can.' + buyButton('watering_can', 'Buy a can');
      else h = '<b>Hold</b> over the soil to water. Dry soil looks pale, wet soil dark. Can <span id="gcan"><i style="width:' + Math.round((can / 9) * 100) + '%"></i></span>' + can.toFixed(1) + ' L <button type="button" data-act="refill">Refill</button>';
    } else if (tool === 'hoe') h = owns('hoe') ? '<b>Drag</b> over a bed to hoe the weeds off at the root.' : 'You need a hoe.' + buyButton('hoe', 'Buy a hoe');
    else if (tool === 'harvest') h = '<b>Click</b> or drag over ripe plants to harvest them.';
    else if (tool === 'inspect') h = '<b>Click</b> a plant or a bed to see how it is doing and why.';
    else if (tool === 'mulch') h = have('mulch_straw') > 0 ? '<b>Drag</b> over a bed to spread straw: it keeps the soil moist and the weeds down. You have ' + Math.round(have('mulch_straw')) + ' L.' : 'Straw mulch keeps the soil moist and smothers weeds.' + buyButton('mulch_straw', 'Buy 150 L');
    else if (tool === 'compost') h = have('compost') > 0 ? '<b>Drag</b> over a bed to spread compost (2 cm). It feeds the soil for months. You have ' + Math.round(have('compost')) + ' L.' : 'Compost feeds the soil slowly, for months.' + buyButton('compost', 'Buy 40 L');
    const fr = read.frostTonight(G.sim.state.sys.weather);
    if (fr.level === 'likely' && Object.keys(s.plants).length && Object.values(s.field.groups).some((b) => !b.cover) && flash.until <= now) h = '<b>' + esc(fr.text) + '</b> Cover the beds tonight. <button type="button" class="go" data-act="cover">Cover the beds</button><br>' + h;
    if (h !== hintSig || force) { hintSig = h; hint.innerHTML = h; }
  }

  /* ================= input ================= */
  function setPtr(e) {
    const r = canvas.getBoundingClientRect();
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.ndcX = ((e.clientX - r.left) / r.width) * 2 - 1; ptr.ndcY = -(((e.clientY - r.top) / r.height) * 2 - 1);
    ptr.ground = groundAt(ptr.ndcX, ptr.ndcY, gp) ? gp : null;
  }
  const fingers = new Map();
  window.addEventListener('pointerdown', (e) => {
    if (!on || e.target !== canvas) return;
    e.stopImmediatePropagation(); e.preventDefault();
    canvas.focus();
    if (e.pointerType === 'touch') { fingers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (fingers.size > 1) { ptr.down = false; drag = null; return; } }
    setPtr(e);
    if (e.button === 2) { ptr.btn = 2; ptr.rx = e.clientX; ptr.ry = e.clientY; return; }
    if (e.button !== 0) return;
    ptr.down = true; ptr.btn = 0; acting = 1;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    press();
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (!on || (e.target !== canvas && !ptr.down && ptr.btn !== 2)) return;
    e.stopImmediatePropagation();
    if (e.pointerType === 'touch' && fingers.size > 1) {
      // two fingers: turn and tilt the view
      const f = fingers.get(e.pointerId); if (!f) return;
      G.cam.yaw -= (e.clientX - f.x) * 0.003; G.cam.pitch = clamp(G.cam.pitch + (e.clientY - f.y) * 0.002, 0.5, 1.35);
      f.x = e.clientX; f.y = e.clientY; return;
    }
    if (ptr.btn === 2 && (e.buttons & 2)) {
      G.cam.yaw -= (e.clientX - ptr.rx) * 0.005; G.cam.pitch = clamp(G.cam.pitch + (e.clientY - ptr.ry) * 0.004, 0.5, 1.35);
      ptr.rx = e.clientX; ptr.ry = e.clientY; return;
    }
    setPtr(e);
    ptr.inside = true;
    if (ptr.down && drag && ptr.ground) { drag.b.x = ptr.ground.x; drag.b.z = ptr.ground.z; }
    hover();
  }, true);
  const up = (e) => {
    if (!on) return;
    if (e.pointerType === 'touch') fingers.delete(e.pointerId);
    if (ptr.btn === 2) { ptr.btn = -1; e.stopImmediatePropagation(); return; }
    if (!ptr.down) return;
    e.stopImmediatePropagation();
    ptr.down = false; ptr.btn = -1;
    release();
  };
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  canvas.addEventListener('contextmenu', (e) => { if (on) e.preventDefault(); });

  function press() {
    const g = ptr.ground; if (!g) return;
    if (tool === 'bed') {
      if (marked && inRect(g, marked)) { marked.digging = true; return; }
      if (!(owns('spade') || owns('shovel'))) { say('You need a spade first.'); return; }
      marked = null; markedLine.visible = false;
      drag = { a: { x: g.x, z: g.z }, b: { x: g.x, z: g.z } };
    } else if (tool === 'sow') {
      drag = { a: { x: g.x, z: g.z }, b: { x: g.x, z: g.z } };
    } else if (tool === 'inspect') inspectAt(g);
    else if (tool === 'harvest') harvestAt(g);
  }
  function release() {
    if (tool === 'bed' && drag) {
      const r = rectOf(drag); drag = null; outline.visible = false; label.hidden = true;
      if (r && r.nx * r.nz >= 1) {
        const c = cellAt(r.x0 + 0.01, r.z0 + 0.01);
        if (overlapsBed(r)) say('That overlaps a bed already there.');
        else { marked = { ...r, done: 0, digging: false }; rectLine(markedLine, r.x0, r.z0, r.x0 + r.nx * CELL, r.z0 + r.nz * CELL, true); tipEvent('marked'); }
      }
    } else if (tool === 'bed' && marked) marked.digging = false;
    else if (tool === 'sow' && drag) { sowRect(rectOf(drag, true)); drag = null; outline.visible = false; label.hidden = true; dots.count = 0; }
    updateHint(true);
  }
  const inRect = (g, r) => g.x >= r.x0 && g.x <= r.x0 + r.nx * CELL && g.z >= r.z0 && g.z <= r.z0 + r.nz * CELL;
  function rectOf(d, cellsOnly) {
    const ax = Math.min(d.a.x, d.b.x), bx = Math.max(d.a.x, d.b.x), az = Math.min(d.a.z, d.b.z), bz = Math.max(d.a.z, d.b.z);
    if (cellsOnly) return { ax, bx, az, bz };
    const x0 = snap(ax), z0 = snap(az), nx = Math.max(1, Math.round((bx - x0) / CELL)), nz = Math.max(1, Math.round((bz - z0) / CELL));
    return { x0, z0, nx: Math.min(nx, 50), nz: Math.min(nz, 50) };
  }
  function overlapsBed(r) {
    for (const b of Object.values(S().field.groups)) if (r.x0 < b.x0 + b.nx * CELL - 1e-6 && b.x0 < r.x0 + r.nx * CELL - 1e-6 && r.z0 < b.z0 + b.nz * CELL - 1e-6 && b.z0 < r.z0 + r.nz * CELL - 1e-6) return true;
    return false;
  }
  function hover() {
    const g = ptr.ground;
    brushRing.visible = false;
    if (!g) { label.hidden = true; return; }
    if ((tool === 'bed' || tool === 'sow') && drag) {
      if (tool === 'bed') {
        const r = rectOf(drag), W = r.nx * CELL, D = r.nz * CELL;
        rectLine(outline, r.x0, r.z0, r.x0 + W, r.z0 + D);
        label.hidden = false; label.textContent = W.toFixed(1) + ' m × ' + D.toFixed(1) + ' m · ' + (W * D).toFixed(2) + ' m²' + (overlapsBed(r) ? ' · overlaps a bed' : '');
      } else spacingGhost(rectOf(drag, true));
      label.style.transform = 'translate(' + (ptr.x + 16) + 'px,' + (ptr.y - 30) + 'px)';
      return;
    }
    label.hidden = true;
    if (tool === 'sow') spacingGhost({ ax: g.x, bx: g.x, az: g.z, bz: g.z });
    if (BRUSH[tool]) {
      const r = BRUSH[tool];
      brushRing.scale.setScalar(r / 0.44); brushRing.position.set(g.x, g.y + 0.1, g.z); brushRing.visible = true;
    }
  }
  // the dots where seeds would go
  function spacingGhost(r) {
    const span = spanOf(crop), per = CROPS[crop].per, grid = Math.ceil(Math.sqrt(per));
    let n = 0;
    for (const b of Object.values(S().field.groups)) for (let iz = 0; iz < b.nz; iz++) for (let ix = 0; ix < b.nx; ix++) {
      const cx = b.x0 + (ix + 0.5) * CELL, cz = b.z0 + (iz + 0.5) * CELL;
      if (cx < r.ax - CELL / 2 || cx > r.bx + CELL / 2 || cz < r.az - CELL / 2 || cz > r.bz + CELL / 2) continue;
      if (span > 1 && (ix % span || iz % span)) continue;
      if (b.cells[iz * b.nx + ix].pl) continue;
      for (let j = 0; j < per && n < 1600; j++) {
        const x = b.x0 + (ix + (span > 1 ? span / 2 : ((j % grid) + 0.5) / grid)) * CELL, z = b.z0 + (iz + (span > 1 ? span / 2 : (Math.floor(j / grid) + 0.5) / grid)) * CELL;
        _m.makeTranslation(x, G.heightAt(x, z) + RAISE + 0.02, z); dots.setMatrixAt(n++, _m);
      }
    }
    dots.count = n; dots.instanceMatrix.needsUpdate = true;
  }
  function sowRect(r) {
    const span = spanOf(crop), cells = {};
    for (const b of Object.values(S().field.groups)) for (let iz = 0; iz < b.nz; iz++) for (let ix = 0; ix < b.nx; ix++) {
      const cx = b.x0 + (ix + 0.5) * CELL, cz = b.z0 + (iz + 0.5) * CELL;
      if (cx < r.ax - CELL / 2 || cx > r.bx + CELL / 2 || cz < r.az - CELL / 2 || cz > r.bz + CELL / 2) continue;
      if (span > 1 && (ix % span || iz % span)) continue;
      (cells[b.id] || (cells[b.id] = [])).push(iz * b.nx + ix);
    }
    const ids = Object.keys(cells);
    if (!ids.length) { say('Sow on a bed: make one first with the Bed tool.'); return; }
    let sown = 0, why = '';
    for (const id of ids) { const res = cmd('garden.sow', { crop, bed: id, cells: cells[id] }); if (res.ok) sown += res.plants; else why = res.reason; if (res.partial) why = res.reason; }
    if (sown) { say('Sowed ' + sown + (spanOf(crop) > 1 || CROPS[crop].count === 1 ? ' ' + (sown === 1 ? CROPS[crop].name.toLowerCase() : CROPS[crop].plural) : ' squares of ' + CROPS[crop].plural) + '.' + (why ? ' ' + why : '') + ' Water them in.'); tipEvent('sown'); }
    else say(why || 'Nothing to sow there.');
    renderSeeds();
  }
  // while a tool is held down: water, hoe, mulch, compost or harvest the swathe under the pointer
  function holdAct(dt) {
    const g = ptr.ground; if (!g || !ptr.down) return;
    acting += dt;
    if (tool === 'bed' && marked && marked.digging) return dig(dt);
    if (acting < 0.16) return;
    const step = acting; acting = 0;
    const sel = { x: g.x, z: g.z, r: BRUSH[tool] || 0.4 };
    if (!cellAt(g.x, g.z) && tool !== 'harvest') return;
    if (tool === 'water') {
      if (!owns('watering_can')) return say('You need a watering can.');
      if (S().can.litres <= 0.01) return say('The can is empty. Refill it.');
      const res = cmd('garden.water', { ...sel, litres: Math.min(S().can.litres, 1.6 * step) });   // a can's rose pours about 1.5 L a second
      if (res.ok) { G.burst(g.x, g.y + 0.5, g.z, 6, 0x9fd4f2, 1.2, 0.2, 0.05, 0.5); tipEvent('watered'); }
      updateHint();
    } else if (tool === 'hoe') {
      if (!owns('hoe')) return say('You need a hoe.');
      const res = cmd('garden.hoe', sel);
      if (res.ok) G.burst(g.x, g.y + 0.1, g.z, res.clearedM2 > 0.01 ? 7 : 3, res.clearedM2 > 0.01 ? 0x6f9a3a : 0x6b4f35, 1.4, 2, 0.05, 0.5);
    } else if (tool === 'mulch' || tool === 'compost') {
      const area = Math.PI * sel.r * sel.r;
      const res = tool === 'mulch' ? cmd('garden.mulch', { ...sel, litres: area * 75 * 0.5 }) : cmd('garden.amend', { ...sel, kind: 'compost', litres: area * 20 * 0.5 });
      if (res.ok) G.burst(g.x, g.y + 0.2, g.z, 6, tool === 'mulch' ? 0xe8c97a : 0x4a3324, 1, 1.5, 0.05, 0.5);
      else say(res.reason);
      updateHint();
    } else if (tool === 'harvest') harvestAt(g, true);
  }
  // turning the sod: hold to dig, a moment for a small bed (with a spade; the shovel is slower)
  function dig(dt) {
    const m = marked, area = m.nx * m.nz * CELL * CELL;
    const secs = clamp(0.7 + area * 0.75, 0.9, 6) * (owns('spade') ? 1 : 1.5);
    m.done = Math.min(1, m.done + dt / secs);
    const x = m.x0 + Math.random() * m.nx * CELL, z = m.z0 + Math.random() * m.nz * CELL;
    if (Math.random() < dt * 14) G.burst(x, G.heightAt(x, z) + 0.15, z, 4, Math.random() < 0.3 ? 0x5e8a3a : 0x6b4f35, 1.6, 2.6, 0.06, 0.6);
    prog.hidden = false; prog.style.left = ptr.x + 'px'; prog.style.top = ptr.y + 'px';
    progArc.setAttribute('stroke-dashoffset', String(138.2 * (1 - m.done)));
    if (m.done >= 1) {
      const res = cmd('garden.makeBed', { x0: m.x0, z0: m.z0, nx: m.nx, nz: m.nz });
      marked = null; markedLine.visible = false; prog.hidden = true;
      if (res.ok) { say('A new bed: ' + res.areaM2.toFixed(2) + ' m² of fresh soil. Now sow something.'); for (let k = 0; k < 14; k++) { const xx = m.x0 + Math.random() * m.nx * CELL, zz = m.z0 + Math.random() * m.nz * CELL; G.burst(xx, G.heightAt(xx, zz) + 0.2, zz, 5, 0x6b4f35, 2.2, 3.4, 0.07, 0.8); } tipEvent('bed'); setGTool('sow'); }
      else say(res.reason);
    }
  }

  /* ================= harvest flourish ================= */
  const WORD = { pull: 'Pulled', pick: 'Picked', cut: 'Cut', dig: 'Dug', twist: 'Snapped off', reap: 'Reaped' };
  const fxPt = { x: 0, y: 0, vis: false };
  function harvestAt(g, quiet) {
    const res = cmd('garden.harvest', { x: g.x, z: g.z, r: BRUSH.harvest });
    if (!res.ok) { if (!quiet) { const c = cellAt(g.x, g.z), p = c && c.bed.cells[c.i].pl && S().plants[c.bed.cells[c.i].pl]; say(p ? read.plantStatus(G.sim.state, p.id).reason : res.reason); } return; }
    const byCrop = {};
    for (const pk of res.picks) (byCrop[pk.crop] || (byCrop[pk.crop] = [])).push(pk);
    let i = 0;
    for (const c in byCrop) {
      const kg = res.kg[c], pk = byCrop[c], n = pk.length * (CROPS[c].count > 1 ? CROPS[c].count : 1);
      const it = res.items && Object.entries(res.items).find(([id]) => id === ITEMS[read.produceOf(c)].id);
      for (const p of pk) {
        const b = S().field.groups[p.bed] || bedViews.get(p.bed)?.b; if (!b) continue;
        const span = spanOf(c), x = b.x0 + ((p.cell % b.nx) + span / 2) * CELL, z = b.z0 + (Math.floor(p.cell / b.nx) + span / 2) * CELL, y = G.heightAt(x, z) + 0.2;
        G.burst(x, y, z, 10, CROPS[c].col, 2.2, 3.2, 0.06, 0.8);
        if (CROPS[c].gesture === 'pull' || CROPS[c].gesture === 'dig') popPlant(c, x, y - 0.15, z);
      }
      const p0 = pk[0], b0 = S().field.groups[p0.bed];
      if (b0) {
        const x = b0.x0 + ((p0.cell % b0.nx) + 0.5) * CELL, z = b0.z0 + (Math.floor(p0.cell / b0.nx) + 0.5) * CELL;
        toScreen(x, G.heightAt(x, z) + 0.6, z, fxPt);
        const el = document.createElement('div');
        el.className = 'pop'; el.style.left = fxPt.x + 'px'; el.style.top = (fxPt.y - i * 30) + 'px';
        const what = CROPS[c].count > 1 && CROPS[c].gesture === 'pull' ? n + ' ' + CROPS[c].plural : CROPS[c].plural;
        el.innerHTML = esc(WORD[CROPS[c].gesture] + ' ' + what) + '<small>+' + (kg < 1 ? Math.round(kg * 1000) + ' g' : kg.toFixed(1) + ' kg') + (it ? ' · ' + it[1] + ' for the kitchen' : '') + '</small>';
        fxEl.appendChild(el); setTimeout(() => el.remove(), 1700);
      }
      i++;
      tipEvent('harvest', c);
    }
  }
  // a pulled root lifts out of the soil and fades
  const pops = [];
  function popPlant(c, x, y, z) {
    if (pops.length > 10) return;
    const m = new T.Mesh(geoFor(c, 'ready'), plantMat);
    m.position.set(x, y, z); m.rotation.y = Math.random() * 6.28;
    G.scene.add(m); pops.push({ m, t: 0 });
  }
  function animatePops(dt) {
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i]; p.t += dt;
      p.m.position.y += dt * (1.6 - p.t * 2.5); p.m.rotation.z = p.t * 1.5;
      p.m.scale.setScalar(Math.max(0.01, 1.25 - p.t * 1.3));
      if (p.t > 0.9) { G.scene.remove(p.m); pops.splice(i, 1); }
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
          '<span class="lab" style="left:6%">Sown ' + esc(dayText(p.sownT)) + '</span><span class="lab" style="left:88%">' + (p.readyT ? 'Ready ' : 'Harvest ~') + esc(dayText(p.expectT)) + '</span></div>';
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
  const PROJECT = { id: 'salad', title: 'Grow your first salad', blurb: 'Press 5 for the Garden. Make a small bed, sow radish and lettuce, water them, and eat them in about four weeks.' };
  const TIPS = {
    start: { h: 'Grow your first salad', b: 'Drag on the grass to mark out a small bed, then hold on it to dig. About 1.2 by 1 metre is plenty.', why: 'Turning the sod gives the seeds loose soil without grass roots to fight.' },
    sow: { h: 'Sow radish and lettuce', b: 'Pick the radish packet above, then drag across the bed. Do the same with lettuce.', why: 'Radishes are ready in about four weeks, leaf lettuce in about six. Both like the cool spring.' },
    water: { h: 'Water them in', b: 'Choose Water and hold over the bed. Dry soil is pale; wet soil turns dark.', why: 'Seeds only sprout in moist soil. Water again when the soil looks pale, not every day.' },
    wait: { h: 'Now let them grow', b: 'Speed up time with the clock buttons if you like. Use Inspect on a plant to see how it is doing.', why: 'Plants grow on warmth and light: a cool week is slower than a warm one.' },
    harvest: { h: 'Your first radishes!', b: 'Choose Harvest and click the ripe radishes. They go straight into your stores.', why: 'Leave them too long and they turn woody, so pick them when ready.' },
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
    if (ev === 'bed' || ev === 'marked') { tipState.start = true; showTip('sow'); }
    else if (ev === 'sown') { tipState.sow = tipState.sow || false; showTip('water'); }
    else if (ev === 'watered' && tip.dataset.id === 'water' && !tip.hidden) { tipState.water = true; saveTips(); showTip('wait'); }
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

  /* ================= switching the Garden on and off ================= */
  function enter() {
    on = true; document.body.classList.add('gardening'); bar.hidden = false;
    if (document.pointerLockElement) document.exitPointerLock();
    const r = findRing(); if (r) r.scale.setScalar(0);
    ensureProject();
    setGTool(tool);
    if (!Object.keys(S().field.groups).length && !tipState.start) showTip('start');
  }
  function leave() {
    on = false; document.body.classList.remove('gardening'); bar.hidden = true; tip.hidden = true;
    const r = findRing(); if (r) r.scale.setScalar(1);
    outline.visible = false; brushRing.visible = false; label.hidden = true; prog.hidden = true; dots.count = 0; drag = null;
    if (marked) { marked.digging = false; }
  }
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (G.player.tool === 'build') return;                     // build mode has first refusal while open
    if (e.code === 'Digit5' && !e.repeat) { G.setTool(G.player.tool === 'garden' ? 'axe' : 'garden'); e.preventDefault(); }
    else if (e.code === 'KeyN' && !e.repeat) { toggleAlmanac(); e.preventDefault(); }
    else if (e.code === 'Escape') { if (!card.hidden) { card.hidden = true; cardFor = null; } else if (!alm.hidden) toggleAlmanac(false); else if (marked) { marked = null; markedLine.visible = false; } }
  });

  /* ================= every frame (cheap) and four times a second (the garden's look) ================= */
  let last = performance.now(), slow = 0, bedSig = '';
  function frame(t) {
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    const want = G.player.tool === 'garden';
    if (want !== on) { if (want) enter(); else leave(); }
    if (on && ptr.down) holdAct(dt);
    if (!(on && ptr.down && tool === 'bed' && marked && marked.digging)) prog.hidden = true;
    if (pops.length) animatePops(dt);
    slow += dt;
    if (slow > 0.25 || dirty) { slow = 0; refresh(); dirty = false; }
    requestAnimationFrame(frame);
  }
  function refresh() {
    const s = S(), ids = Object.keys(s.field.groups);
    const sig = ids.join(',');
    if (sig !== bedSig) {
      for (const id of [...bedViews.keys()]) if (!s.field.groups[id]) dropBed(id);
      for (const id of ids) if (!bedViews.has(id)) buildBed(s.field.groups[id]);
      bedSig = sig;
    }
    for (const v of bedViews.values()) { v.b = s.field.groups[v.b.id] || v.b; paintBed(v); }
    if (ids.length) hideGrass();
    const ps = plantSignature();
    if (ps !== plantSig) { plantSig = ps; layoutPlants(); }
    layoutWeeds();
    if (on) { updateHint(); tipsTick(); }
    if (!alm.hidden) renderAlmanac();
    if (cardFor && !card.hidden && (G.sim.ticksLastAdvance || dirty)) renderCard();
  }
  G.sim.listen((type) => { if (type === 'loaded') { bedSig = ''; plantSig = ''; weedSig = ''; for (const v of bedViews.values()) v.sig.fill(-1); dirty = true; } });
  requestAnimationFrame(frame);

  // test hooks
  window.__gardenView = {
    get on() { return on; }, get tool() { return tool; }, setTool: setGTool, choose: (c) => { crop = c; renderSeeds(); },
    groundAt: (nx, ny) => { const o = {}; return groundAt(nx, ny, o) ? o : null; }, toScreen: (x, y, z) => toScreen(x, y, z, {}),
    meshes: () => [...meshes.entries()].map(([k, m]) => [k, m.count]), beds: () => [...bedViews.keys()], almanac: toggleAlmanac,
    inspect: (x, z) => inspectAt({ x, z }), refresh: () => { dirty = true; refresh(); },
  };
})();
