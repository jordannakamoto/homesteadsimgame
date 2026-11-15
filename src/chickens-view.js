/* Chickens view: the birds, their coop and kit, and the Chickens panel (H).
   Draws the simulation's flock (sim.state.sys.chickens); owns no truth. Where a bird walks, pecks, dust-bathes
   or sits is animation derived from the sim's phase for that bird (range, coop, tractor, roost, out).
   Cheap: every bird is one instance of one InstancedMesh, posed in the vertex shader from four floats; eggs are
   a second InstancedMesh. Fixture models are a handful of plain meshes rebuilt only when the fixtures change.
   Reaches the game only through window.__game. */
(() => {
  const G = window.__game;
  if (!G || !G.sim || !G.THREE) return;
  const T = G.THREE,
    $ = (id) => document.getElementById(id);
  const sysOf = () => G.sim.systems.find((s) => s.name === 'chickens');
  if (!sysOf()) return;
  const API = sysOf().api;
  const CK = () => G.sim.state.sys.chickens;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const H = (x, z) => G.heightAt(x, z);
  let rs = 0x2545f491; // cosmetic randomness only
  const rnd = () => { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return ((rs >>> 0) % 100000) / 100000; };

  /* ================= the chicken model =================
     Built for a 2.5 kg hen facing +z, feet at y = 0. aGrp.x = colour (0 plumage, 1 tail and hackle, 2 fixed,
     4 wing), aGrp.y = motion group (0 body, 1 head, 2 legs, 3 tail, 4 comb, 5 left wing, 6 right wing). */
  const P = [], N = [], Cc = [], A = [];
  const RED = [0.72, 0.1, 0.08], YEL = [0.86, 0.66, 0.22], DARK = [0.05, 0.04, 0.04];
  function tri(a, b, c, col, cm, g) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map((x) => x / l);
    for (const p of [a, b, c]) { P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); Cc.push(col[0], col[1], col[2]); A.push(cm, g); }
  }
  // low-poly ellipsoid, flat shaded (lat bands x lon segments), optionally pitched about x
  function ball(c, r, lat, lon, col, cm, g, pitch = 0) {
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const pt = (i, j) => {
      const th = (i / lat) * Math.PI, ph = (j / lon) * Math.PI * 2;
      let x = Math.sin(th) * Math.sin(ph) * r[0], y = Math.cos(th) * r[1], z = Math.sin(th) * Math.cos(ph) * r[2];
      const y2 = y * cp - z * sp, z2 = y * sp + z * cp;
      return [c[0] + x, c[1] + y2, c[2] + z2];
    };
    for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
      const a = pt(i, j), b = pt(i + 1, j), d = pt(i, j + 1), e = pt(i + 1, j + 1);
      if (i > 0) tri(a, d, b, col, cm, g);
      if (i < lat - 1) tri(d, e, b, col, cm, g);
    }
  }
  function cyl(a, b, r, seg, col, cm, g) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ux = Math.abs(d[1]) > 0.9 * Math.hypot(...d) ? [1, 0, 0] : [0, 1, 0];
    let p = [d[1] * ux[2] - d[2] * ux[1], d[2] * ux[0] - d[0] * ux[2], d[0] * ux[1] - d[1] * ux[0]];
    const lp = Math.hypot(...p); p = p.map((x) => x / lp);
    const dl = Math.hypot(...d), dn = d.map((x) => x / dl);
    const q = [dn[1] * p[2] - dn[2] * p[1], dn[2] * p[0] - dn[0] * p[2], dn[0] * p[1] - dn[1] * p[0]];
    const at = (o, k) => { const t = (k / seg) * Math.PI * 2, cs = Math.cos(t) * r, sn = Math.sin(t) * r; return [o[0] + p[0] * cs + q[0] * sn, o[1] + p[1] * cs + q[1] * sn, o[2] + p[2] * cs + q[2] * sn]; };
    for (let k = 0; k < seg; k++) { const a0 = at(a, k), a1 = at(a, k + 1), b0 = at(b, k), b1 = at(b, k + 1); tri(a0, b0, a1, col, cm, g); tri(a1, b0, b1, col, cm, g); }
  }
  const W = [1, 1, 1];
  // body: a plump egg shape, tail end up
  ball([0, 0.28, -0.01], [0.13, 0.135, 0.195], 5, 8, W, 0, 0, -0.32);
  ball([0, 0.25, 0.08], [0.11, 0.11, 0.11], 4, 7, W, 0, 0);            // breast
  ball([0, 0.36, 0.12], [0.07, 0.085, 0.07], 3, 6, W, 1, 0);           // hackle (neck feathers)
  // head
  ball([0, 0.46, 0.165], [0.052, 0.055, 0.06], 3, 6, W, 0, 1);
  tri([-0.018, 0.47, 0.215], [0.018, 0.47, 0.215], [0, 0.452, 0.268], YEL, 2, 1);
  tri([-0.018, 0.47, 0.215], [0, 0.445, 0.215], [0, 0.452, 0.268], YEL, 2, 1);
  tri([0.018, 0.47, 0.215], [0, 0.452, 0.268], [0, 0.445, 0.215], YEL, 2, 1);
  for (const sx of [-1, 1]) ball([sx * 0.046, 0.475, 0.19], [0.011, 0.011, 0.011], 2, 4, DARK, 2, 1);
  ball([0, 0.42, 0.205], [0.012, 0.024, 0.014], 2, 5, RED, 2, 4);       // wattles
  // comb: a serrated blade along the crown (scaled flat for a rose comb)
  for (let k = 0; k < 4; k++) {
    const z0 = 0.13 + k * 0.024, hgt = 0.035 + 0.012 * Math.sin((k / 3) * Math.PI);
    tri([0, 0.505, z0], [0, 0.505, z0 + 0.028], [0, 0.505 + hgt, z0 + 0.012], RED, 2, 4);
    tri([0, 0.505, z0 + 0.028], [0, 0.505, z0], [0, 0.505 + hgt, z0 + 0.012], RED, 2, 4);
  }
  ball([0, 0.505, 0.17], [0.012, 0.012, 0.045], 2, 4, RED, 2, 4);
  // tail: a fan of feathers up and back
  for (const [sx, h] of [[-1, 0.15], [-0.4, 0.2], [0.4, 0.2], [1, 0.15]]) {
    const b0 = [sx * 0.05, 0.32, -0.15], b1 = [sx * 0.02, 0.33, -0.14], tip = [sx * 0.07, 0.33 + h, -0.27];
    tri(b0, b1, tip, W, 1, 3); tri(b1, b0, tip, W, 1, 3);
  }
  // wings
  for (const sx of [-1, 1]) ball([sx * 0.118, 0.29, -0.02], [0.03, 0.085, 0.15], 3, 6, W, 4, sx < 0 ? 5 : 6, -0.25);
  // legs and toes
  for (const sx of [-1, 1]) {
    cyl([sx * 0.045, 0.17, 0.0], [sx * 0.05, 0.005, 0.02], 0.012, 4, YEL, 2, 2);
    for (const a of [-0.5, 0, 0.5]) tri([sx * 0.05, 0.004, 0.02], [sx * 0.05 + Math.sin(a) * 0.06, 0.002, 0.02 + Math.cos(a) * 0.06], [sx * 0.05 + 0.01, 0.006, 0.02], YEL, 2, 2);
  }
  const ckGeo = new T.InstancedBufferGeometry();
  ckGeo.setAttribute('position', new T.Float32BufferAttribute(P, 3));
  ckGeo.setAttribute('normal', new T.Float32BufferAttribute(N, 3));
  ckGeo.setAttribute('color', new T.Float32BufferAttribute(Cc, 3));
  ckGeo.setAttribute('aGrp', new T.Float32BufferAttribute(A, 2));
  const MAX = 64;
  const iCol1 = new T.InstancedBufferAttribute(new Float32Array(MAX * 3), 3),
    iCol2 = new T.InstancedBufferAttribute(new Float32Array(MAX * 3), 3),
    iLook = new T.InstancedBufferAttribute(new Float32Array(MAX * 4), 4),
    iPose = new T.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
  iPose.setUsage(T.DynamicDrawUsage);
  for (const [n, a] of [['iCol1', iCol1], ['iCol2', iCol2], ['iLook', iLook], ['iPose', iPose]]) ckGeo.setAttribute(n, a);

  const ckMat = new T.MeshLambertMaterial({ vertexColors: true });
  ckMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aGrp; attribute vec3 iCol1; attribute vec3 iCol2; attribute vec4 iLook; attribute vec4 iPose;
        vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z); }
        vec3 rotZ(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z); }
        void ckDeform(inout vec3 p, inout vec3 n) {
          float g = aGrp.y;
          if (g > 3.5 && g < 4.5) {                      // comb and wattles: bigger on a cock, low and wide for a rose comb
            vec3 b = vec3(0.0, 0.505, 0.17); vec3 q = p - b;
            float rose = iLook.w;
            q *= iLook.y; q.y *= mix(1.0, 0.3, rose); q.x *= mix(1.0, 3.0, rose);
            p = b + q;
          }
          if (g > 2.5 && g < 3.5) { vec3 b = vec3(0.0, 0.33, -0.14); p = b + (p - b) * vec3(1.0 + 0.3 * (iLook.z - 1.0), iLook.z, iLook.z); }
          if ((g > 0.5 && g < 1.5) || (g > 3.5 && g < 4.5)) {   // head and neck: peck, look about
            vec3 b = vec3(0.0, 0.36, 0.11);
            p = b + rotX(p - b, iPose.x); n = rotX(n, iPose.x);
          }
          if (g > 4.5) {                                   // wings: flap
            float sd = g > 5.5 ? 1.0 : -1.0; vec3 b = vec3(sd * 0.1, 0.34, 0.0);
            p = b + rotZ(p - b, sd * iPose.z); n = rotZ(n, sd * iPose.z);
          }
          if (g > 1.5 && g < 2.5) {                        // legs: stride, fold away when sitting
            float sd = p.x < 0.0 ? 1.0 : -1.0; vec3 b = vec3(p.x, 0.17, 0.0);
            p = b + rotX(p - b, sd * sin(iPose.w) * 0.55);
            p.y = mix(p.y, 0.16, iPose.y);
          }
        }`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(normal); vec3 ckP = vec3(position); ckDeform(ckP, objectNormal);')
      .replace('#include <begin_vertex>', 'vec3 transformed = ckP;')
      .replace('#include <color_vertex>', `#include <color_vertex>
        { float m = aGrp.x; vec3 base = m < 0.5 ? iCol1 : m < 1.5 ? iCol2 : m < 2.5 ? color.rgb : iCol1 * 0.8;
          if (iLook.x > 0.5 && (m < 1.5 || m > 2.5)) { float st = step(0.55, fract(position.y * 46.0 + position.z * 9.0)); base = mix(iCol1, iCol2, st * 0.9); }
          vColor.rgb = base; }`);
  };
  const flockMesh = new T.InstancedMesh(ckGeo, ckMat, MAX);
  flockMesh.castShadow = true; flockMesh.receiveShadow = true; flockMesh.frustumCulled = false; flockMesh.count = 0;
  G.scene.add(flockMesh);

  // eggs in the nest boxes
  const eggGeo = new T.SphereGeometry(0.024, 7, 5); eggGeo.scale(1, 1.3, 1);
  const eggMesh = new T.InstancedMesh(eggGeo, new T.MeshLambertMaterial({ color: 0xffffff }), 48);
  eggMesh.count = 0; eggMesh.castShadow = true; eggMesh.frustumCulled = false;
  eggMesh.instanceColor = new T.InstancedBufferAttribute(new Float32Array(48 * 3), 3);
  G.scene.add(eggMesh);
  const EGG_COL = { brown: [0.62, 0.4, 0.25], white: [0.95, 0.94, 0.9], 'light brown': [0.78, 0.6, 0.44], cream: [0.92, 0.85, 0.7] };

  /* ================= fixtures ================= */
  const mat = (c, o = {}) => new T.MeshLambertMaterial({ color: c, ...o });
  const M = { wood: mat(0x9a7350), dark: mat(0x5b4330), roof: mat(0x6d5a4c), trim: mat(0xd9cfb8), straw: mat(0xd8bb6a), metal: mat(0x9aa2a6),
    red: mat(0xa8322a), feed: mat(0xb8955a), water: mat(0x6f9fb6, { transparent: true, opacity: 0.8 }), glow: new T.MeshBasicMaterial({ color: 0xffe2a0 }) };
  // hardware cloth: a fine grid with see-through holes
  {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const x = cv.getContext('2d'); x.strokeStyle = 'rgba(70,72,72,1)'; x.lineWidth = 3;
    for (let i = 0; i <= 64; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 64); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(64, i); x.stroke(); }
    const tx = new T.CanvasTexture(cv); tx.wrapS = tx.wrapT = T.RepeatWrapping; tx.repeat.set(12, 6);
    M.mesh = new T.MeshLambertMaterial({ map: tx, transparent: true, alphaTest: 0.3, side: T.DoubleSide });
  }
  const box = (g, w, h, d, m, x, y, z, ry = 0) => { const b = new T.Mesh(new T.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.y = ry; b.castShadow = b.receiveShadow = true; g.add(b); return b; };
  const pane = (g, w, h, m, x, y, z, ry = 0) => { const p = new T.Mesh(new T.PlaneGeometry(w, h), m); p.position.set(x, y, z); p.rotation.y = ry; g.add(p); return p; };
  function gable(g, w, d, y0, rise, m, over = 0.12) {
    // two roof planes along x, ridge along x... ridge runs along the width, eaves front and back
    const half = d / 2 + over, len = Math.hypot(half, rise), ang = Math.atan2(rise, half);
    for (const s of [-1, 1]) { const r = box(g, w + 2 * over, 0.04, len, m, 0, y0 + rise / 2, (s * half) / 2); r.rotation.x = s * ang; }
    // gable ends
    const sh = new T.Shape(); sh.moveTo(-d / 2, 0); sh.lineTo(d / 2, 0); sh.lineTo(0, rise); sh.lineTo(-d / 2, 0);
    for (const s of [-1, 1]) { const e = new T.Mesh(new T.ShapeGeometry(sh), M.wood); e.material.side = T.DoubleSide; e.position.set((s * w) / 2, y0, 0); e.rotation.y = Math.PI / 2; e.castShadow = true; g.add(e); }
  }

  function buildCoop(e) {
    const g = new T.Group(), w = e.cat.dims.w, d = e.cat.dims.d, fl = 0.45, wh = 0.9;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.08, fl + 0.4, 0.08, M.dark, (sx * (w - 0.1)) / 2, (fl - 0.4) / 2, (sz * (d - 0.1)) / 2);
    box(g, w, 0.05, d, M.dark, 0, fl, 0);                                       // floor
    box(g, w, wh, 0.04, M.wood, 0, fl + wh / 2, -d / 2);                         // back
    for (const s of [-1, 1]) box(g, 0.04, wh, d, M.wood, (s * w) / 2, fl + wh / 2, 0);
    box(g, w, 0.3, 0.04, M.wood, 0, fl + 0.15, d / 2);                           // front: solid below
    pane(g, w - 0.06, wh - 0.32, M.mesh, 0, fl + 0.3 + (wh - 0.3) / 2, d / 2 + 0.005);   // and mesh above
    for (const x of [-w / 2, 0, w / 2]) box(g, 0.05, wh, 0.05, M.trim, x, fl + wh / 2, d / 2 + 0.01);
    box(g, w + 0.1, 0.05, 0.06, M.trim, 0, fl + wh, d / 2 + 0.01);
    gable(g, w, d, fl + wh, 0.42, M.roof);
    box(g, w - 0.1, 0.05, 0.05, M.dark, 0, fl + 0.5, -0.15);                    // roost bar
    // pop door, hinged at its bottom, and the ramp
    const door = new T.Group(); door.position.set(-w / 4, fl + 0.02, d / 2 + 0.03); g.add(door);
    box(door, 0.32, 0.36, 0.03, M.trim, 0, 0.18, 0);
    const ramp = box(g, 0.3, 0.03, 0.85, M.wood, -w / 4, fl / 2, d / 2 + 0.36); ramp.rotation.x = Math.atan2(fl, 0.75);
    for (let i = 0; i < 4; i++) { const sl = box(g, 0.3, 0.02, 0.02, M.dark, -w / 4, 0.08 + i * 0.1, d / 2 + 0.7 - i * 0.12); sl.rotation.x = ramp.rotation.x; }
    const bulb = new T.Mesh(new T.SphereGeometry(0.04, 6, 4), M.glow); bulb.position.set(0, fl + wh - 0.06, 0); bulb.visible = false; g.add(bulb);
    g.userData = { door, bulb, fl };
    return g;
  }
  function buildTractor(e) {
    const g = new T.Group(), w = e.cat.dims.w, d = e.cat.dims.d, h = e.cat.dims.h;
    for (const s of [-1, 1]) box(g, 0.08, 0.1, d, M.dark, (s * (w - 0.08)) / 2, 0.05, 0);   // skids
    for (const s of [-1, 1]) for (const z of [-d / 2, -d / 6, d / 6, d / 2]) box(g, 0.05, h, 0.05, M.wood, (s * (w - 0.08)) / 2, h / 2, z);
    for (const s of [-1, 1]) { box(g, 0.05, 0.05, d, M.wood, (s * (w - 0.08)) / 2, h, 0); pane(g, d, h - 0.1, M.mesh, (s * w) / 2, h / 2, 0, Math.PI / 2); }
    pane(g, w, h - 0.1, M.mesh, 0, h / 2, d / 2); pane(g, w, h - 0.1, M.mesh, 0, h / 2, -d / 2);
    // the roofed house end, a third of the length, and a mesh lid over the run
    const house = new T.Group(); house.position.z = -d / 3; g.add(house);
    box(house, w, 0.04, d / 3, M.dark, 0, 0.45, 0); box(house, w, 0.6, 0.04, M.wood, 0, 0.75, -d / 6); box(house, w, 0.3, 0.04, M.wood, 0, 0.9, d / 6);
    for (const s of [-1, 1]) box(house, 0.04, 0.6, d / 3, M.wood, (s * w) / 2, 0.75, 0);
    gable(house, w, d / 3, h, 0.3, M.roof, 0.06);
    pane(g, w, (2 * d) / 3, M.mesh, 0, h, d / 6, 0).rotation.x = -Math.PI / 2;
    box(g, 0.04, 0.04, w - 0.1, M.dark, 0, 0.7, -d / 3, Math.PI / 2);       // roost
    box(g, 0.22, 0.3, 0.22, M.metal, w / 2 - 0.2, 0.15, d / 2 - 0.25);       // its drinker
    box(g, 0.3, 0.05, 0.12, M.metal, -w / 2 + 0.25, 0.08, d / 2 - 0.25);     // its feed trough
    g.userData = { nest: { x: 0.45, y: 0.5, z: -d / 3 }, fl: 0.45 };
    return g;
  }
  function buildNest(e) {
    const g = new T.Group(), w = e.cat.dims.w, d = e.cat.dims.d;
    for (const s of [-1, 1]) box(g, 0.05, 0.4, 0.05, M.dark, (s * (w - 0.06)) / 2, 0.2, 0);
    box(g, w, 0.04, d, M.wood, 0, 0.4, 0); box(g, w, 0.18, 0.03, M.wood, 0, 0.5, -d / 2); box(g, w, 0.06, 0.03, M.wood, 0, 0.44, d / 2);
    for (const x of [-w / 2, 0, w / 2]) box(g, 0.03, 0.18, d, M.wood, x, 0.5, 0);
    for (const x of [-w / 4, w / 4]) box(g, w / 2 - 0.06, 0.04, d - 0.06, M.straw, x, 0.43, 0);
    const lid = box(g, w + 0.06, 0.03, d * 0.7, M.roof, 0, 0.62, -d * 0.2); lid.rotation.x = -0.5;
    g.userData = { slots: [-w / 4, w / 4], y: 0.47 };
    return g;
  }
  function buildFeeder(e) {
    const g = new T.Group();
    box(g, 0.34, 0.04, 0.34, M.dark, 0, 0.02, 0); box(g, 0.05, 0.2, 0.05, M.dark, 0, 0.12, 0);   // a little stand
    const tube = new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 0.36, 10, 1, true), M.metal); tube.position.y = 0.42; tube.material.side = T.DoubleSide; g.add(tube);
    const feed = new T.Mesh(new T.CylinderGeometry(0.095, 0.095, 1, 10), M.feed); g.add(feed);
    const pan = new T.Mesh(new T.CylinderGeometry(0.17, 0.15, 0.05, 12), M.metal); pan.position.y = 0.22; pan.castShadow = true; g.add(pan);
    const lid = new T.Mesh(new T.ConeGeometry(0.13, 0.08, 10), M.red); lid.position.y = 0.64; lid.castShadow = true; g.add(lid);
    g.userData = { feed, cap: e.cat.feedCapKg };
    return g;
  }
  function buildWaterer(e) {
    const g = new T.Group();
    const base = new T.Mesh(new T.CylinderGeometry(0.19, 0.2, 0.06, 14), M.red); base.position.y = 0.03; base.castShadow = true; g.add(base);
    const body = new T.Mesh(new T.CylinderGeometry(0.13, 0.14, 0.34, 12), new T.MeshLambertMaterial({ color: 0xd8dde0, transparent: true, opacity: 0.55 })); body.position.y = 0.23; g.add(body);
    const water = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 1, 12), M.water); g.add(water);
    const top = new T.Mesh(new T.SphereGeometry(0.13, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2), M.red); top.position.y = 0.4; top.castShadow = true; g.add(top);
    g.userData = { water, cap: e.cat.waterCapL };
    return g;
  }
  function buildRoost(e) { const g = new T.Group(); for (const s of [-1, 1]) box(g, 0.05, 0.6, 0.05, M.dark, (s * e.cat.dims.w) / 2, 0.3, 0); box(g, e.cat.dims.w, 0.05, 0.05, M.wood, 0, 0.6, 0); return g; }
  const BUILD = { coop_small: buildCoop, chicken_tractor: buildTractor, nest_box: buildNest, feeder_hanging: buildFeeder, waterer_fount: buildWaterer, roost_bar: buildRoost };

  const fxRoot = new T.Group(); G.scene.add(fxRoot);
  let fxSig = '', fxList = [], fxById = {};
  function fixturesNow() {
    const s = CK(), out = [];
    const site = G.sim.state.sys.site;
    const all = [...((site && site.pieces) || []).filter((p) => p.kind === 'fixture' && API.FIXTURES_CHICKENS[p.fixture]), ...s.own];
    for (const p of all) { const f = s.fx[p.id] || {}; out.push({ id: p.id, fixture: p.fixture, cat: API.FIXTURES_CHICKENS[p.fixture], x: f.x ?? p.a.x, z: f.z ?? p.a.z, yaw: p.yawRad || 0 }); }
    return out;
  }
  function syncFixtures() {
    const list = fixturesNow();
    const sig = list.map((e) => e.id + e.fixture + e.x.toFixed(2) + e.z.toFixed(2) + e.yaw.toFixed(2)).join('|');
    if (sig === fxSig) return;
    fxSig = sig;
    for (const c of [...fxRoot.children]) { fxRoot.remove(c); c.traverse((o) => o.geometry && o.geometry.dispose()); }
    fxList = list; fxById = {};
    for (const e of list) {
      const g = BUILD[e.fixture](e);
      let y = H(e.x, e.z);
      if (e.cat.dims.w > 1) { const c = Math.cos(e.yaw), s = Math.sin(e.yaw), hw = e.cat.dims.w / 2, hd = e.cat.dims.d / 2; for (const [a, b] of [[hw, hd], [-hw, hd], [hw, -hd], [-hw, -hd]]) y = Math.min(y, H(e.x + a * c + b * s, e.z - a * s + b * c)); }
      g.position.set(e.x, y, e.z); g.rotation.y = e.yaw; e.group = g; e.y = y;
      fxRoot.add(g); fxById[e.id] = e;
    }
  }
  // local (lx, lz) of a fixture to world
  const toWorld = (e, lx, lz) => { const c = Math.cos(e.yaw), s = Math.sin(e.yaw); return [e.x + lx * c + lz * s, e.z - lx * s + lz * c]; };

  /* ================= behaviour on screen ================= */
  const vb = new Map(); // id -> view state
  const tmpM = new T.Matrix4(), tmpQ = new T.Quaternion(), tmpS = new T.Vector3(), tmpP = new T.Vector3(), UP = new T.Vector3(0, 1, 0);
  let lastFed = -1;
  G.sim.listen((type) => { if (type === 'chickens.fed') lastFed = performance.now(); });

  function homeOf(b) { return b.home ? fxById[b.home] : null; }
  function feederFor(b) {
    const home = homeOf(b);
    if (home && home.cat.confines) return null;
    let best = null, bd = 1e9; const v = vb.get(b.id);
    for (const e of fxList) if (e.cat.feedCapKg && !e.cat.movable) { const d = Math.hypot(e.x - v.x, e.z - v.z); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  function roostSlot(b, i, home) {
    if (home.cat.confines) { const [x, z] = toWorld(home, -home.cat.dims.w / 2 + 0.25 + (i % 6) * 0.2, -home.cat.dims.d / 3); return [x, z, home.y + 0.7]; }
    const [x, z] = toWorld(home, -home.cat.dims.w / 2 + 0.2 + (i % 8) * 0.22, -0.15); return [x, z, home.y + 0.95];
  }
  function pickTarget(v, b, centre, home, phase) {
    if (phase === 'coop' && home) { const [x, z] = toWorld(home, (rnd() - 0.5) * (home.cat.dims.w - 0.4), (rnd() - 0.5) * (home.cat.dims.d - 0.4)); return [x, z]; }
    if (phase === 'tractor' && home) { const [x, z] = toWorld(home, (rnd() - 0.5) * (home.cat.dims.w - 0.35), (rnd() * 0.66 - 0.1) * (home.cat.dims.d - 0.3)); return [x, z]; }
    const far = b.quirk && b.quirk.includes('wander') ? 11 : b.quirk && b.quirk.includes('close') ? 3.5 : 6.5;
    const ax = home ? toWorld(home, 0, home.cat.dims.d / 2 + 2.5) : centre;
    const cx = 0.5 * centre[0] + 0.5 * ax[0], cz = 0.5 * centre[1] + 0.5 * ax[1];
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * far;
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
  }
  let frameT = performance.now(), lastSimT = 0;
  const rosterIdx = {};
  function update() {
    const now = performance.now(), dt = Math.min(0.1, (now - frameT) / 1000); frameT = now;
    syncFixtures();
    const s = CK(), birds = s ? Object.values(s.birds) : [];
    flockMesh.count = Math.min(MAX, birds.length);
    flockMesh.visible = birds.length > 0;
    // fixtures: door, light, feed and water levels
    const hour = G.world.time * 24;
    for (const e of fxList) {
      const f = s.fx[e.id] || {}, u = e.group.userData;
      if (u.door) u.door.rotation.x = f.doorOpen ? Math.min(Math.PI / 2 - 0.12, u.door.rotation.x + dt * 3) : Math.max(0, u.door.rotation.x - dt * 3);
      if (u.bulb) { const on = f.light && f.light.on && (hour < 9 || hour > 16); u.bulb.visible = !!on; }
      if (u.feed) { const k = clamp((f.feedKg || 0) / u.cap, 0.001, 1); u.feed.scale.y = 0.34 * k; u.feed.position.y = 0.25 + 0.17 * k; }
      if (u.water) { const k = clamp((f.waterL || 0) / u.cap, 0.001, 1); u.water.scale.y = 0.32 * k; u.water.position.y = 0.07 + 0.16 * k; u.water.material.color.setHex(f.iceL > 0.5 * (f.waterL || 1) ? 0xdfeef5 : 0x6f9fb6); }
    }
    if (!birds.length) { eggMesh.count = 0; return; }
    let cx = 0, cz = 0;
    for (const b of birds) { const v = vb.get(b.id); if (v) { cx += v.x; cz += v.z; } }
    const centre = [cx / birds.length, cz / birds.length];
    const simT = G.sim.state.t, jumped = simT - lastSimT > 1200 || simT < lastSimT; lastSimT = simT;
    const fast = G.speed >= 100 || jumped, fedRecently = now - lastFed < 9000;
    for (const k in rosterIdx) delete rosterIdx[k];
    let i = 0;
    for (const b of birds) {
      if (i >= MAX) break;
      const home = homeOf(b);
      let v = vb.get(b.id);
      if (!v) {
        let x = G.player.x + (rnd() - 0.5) * 3, z = G.player.z + 2 + rnd() * 2;
        if (home) [x, z] = toWorld(home, (rnd() - 0.5) * 2, home.cat.dims.d / 2 + 1 + rnd() * 2);
        v = { x, z, y: H(x, z), yaw: rnd() * 6.28, tx: x, tz: z, act: 'idle', timer: rnd() * 2, gait: 0, peck: 0, sit: 0, hop: 0, flap: 0, look: 0, inside: false };
        vb.set(b.id, v);
        setLook(i, b);
      } else if (v.lookKey !== b.plumage + b.sex + b.comb) setLook(i, b);
      v.slot = i;
      const ri = home ? (rosterIdx[home.id] = (rosterIdx[home.id] || 0) + 1) - 1 : 0;
      const phase = b.phase;
      let wantSit = 0, speed = 0.45 + (b.personality === 'flighty' ? 0.25 : 0);
      if (phase === 'roost' && home) {
        const [x, z, y] = roostSlot(b, ri, home);
        if (fast || !v.inside && Math.hypot(v.x - x, v.z - z) > 6) { v.x = x; v.z = z; v.inside = true; }
        if (!v.inside) {
          // walk to the foot of the ramp, then pop inside
          const [rx, rz] = home.cat.confines ? toWorld(home, 0, 0) : toWorld(home, -home.cat.dims.w / 4, home.cat.dims.d / 2 + 0.8);
          v.tx = rx; v.tz = rz;
          if (Math.hypot(v.x - rx, v.z - rz) < 0.35) { v.inside = true; v.x = x; v.z = z; }
        } else { v.x += (x - v.x) * Math.min(1, dt * 4); v.z += (z - v.z) * Math.min(1, dt * 4); v.tx = v.x; v.tz = v.z; v.yRoost = y; wantSit = 1; speed = 0; v.yaw += ((home.yaw) - v.yaw) * Math.min(1, dt * 3); }
      } else if (phase === 'out' || phase === 'wildRoost') {
        if (home && !v.huddle) { const [hx, hz] = toWorld(home, (ri % 5) * 0.3 - 0.6, home.cat.dims.d / 2 + 0.35); v.huddle = [hx, hz]; }
        if (v.huddle) { v.tx = v.huddle[0]; v.tz = v.huddle[1]; }
        if (Math.hypot(v.tx - v.x, v.tz - v.z) < 0.3 || fast || phase === 'wildRoost') { wantSit = 1; speed = 0; if (fast) { v.x = v.tx; v.z = v.tz; } }
        v.inside = false;
      } else {
        v.huddle = null; v.yRoost = null;
        if (v.inside && home && !home.cat.confines && phase !== 'coop') {           // morning: out of the pop door and down the ramp
          const [rx, rz] = toWorld(home, -home.cat.dims.w / 4, home.cat.dims.d / 2 + 0.9); v.x = rx; v.z = rz; v.inside = false; v.tx = rx; v.tz = rz + 0.5;
        }
        if (phase === 'coop' && home && !v.inside) { const [x, z] = toWorld(home, 0, 0); v.x = x; v.z = z; v.inside = true; }
        if (phase === 'tractor') v.inside = false;
        v.timer -= dt;
        const fd = (fedRecently || b.mood === 'hungry' || (b.quirk || '').includes('first to the feeder') && fedRecently) && phase === 'range' && feederFor(b);
        if (v.timer <= 0 || (fd && v.act !== 'feed')) {
          const r = rnd(), sunny = hour > 11 && hour < 16 && (G.sim.state.sys.weather || {}).cloud < 0.5;
          if (fd) { const [ax, az] = [fd.x + Math.cos(i * 1.7) * 0.32, fd.z + Math.sin(i * 1.7) * 0.32]; v.tx = ax; v.tz = az; v.act = 'feed'; v.timer = 6 + rnd() * 4; if (fedRecently && !v.hopped) { v.hop = 1; v.hopped = true; } }
          else if (phase !== 'coop' && sunny && r < ((b.quirk || '').includes('dust') ? 0.25 : 0.05)) { v.act = 'dust'; v.timer = 8 + rnd() * 8; v.tx = v.x; v.tz = v.z; }
          else if (r < 0.45) { [v.tx, v.tz] = pickTarget(v, b, centre, home, phase); v.act = 'walk'; v.timer = 5 + rnd() * 6; }
          else { v.act = r < 0.85 ? 'peck' : 'idle'; v.timer = 2 + rnd() * 4; v.tx = v.x; v.tz = v.z; }
          if (!fedRecently) v.hopped = false;
        }
        if (v.act === 'dust') wantSit = 0.8;
        if (fast && phase !== 'range') { v.x = v.tx; v.z = v.tz; }
      }
      // move toward the target
      const dx = v.tx - v.x, dz = v.tz - v.z, dist = Math.hypot(dx, dz);
      const moving = dist > 0.05 && speed > 0;
      if (moving) {
        const want = Math.atan2(dx, dz);
        let dy = want - v.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        v.yaw += clamp(dy, -dt * 6, dt * 6);
        const st = Math.min(dist, speed * dt * (fast ? 20 : 1) * (Math.abs(dy) < 1.2 ? 1 : 0.3));
        v.x += Math.sin(v.yaw) * st; v.z += Math.cos(v.yaw) * st;
        v.gait += st * 26;
      }
      // pose
      v.sit += (wantSit - v.sit) * Math.min(1, dt * 3);
      const peck = !moving && (v.act === 'peck' || v.act === 'feed') && wantSit < 0.5 ? Math.max(0, Math.sin(now / 1000 * 5 + i * 2.1)) : 0;
      const look = !moving && v.act === 'idle' ? 0.25 * Math.sin(now / 1000 * 0.9 + i) : 0;
      const bob = moving ? Math.abs(Math.sin(v.gait)) * 0.015 : 0;
      v.hop = Math.max(0, v.hop - dt * 1.6);
      const hopY = Math.sin(v.hop * Math.PI) * 0.18;
      v.flap = v.hop > 0 ? Math.sin(now / 1000 * 30) * 0.5 + 0.5 : v.act === 'dust' ? 0.35 + 0.3 * Math.sin(now / 1000 * 9 + i) : 0;
      let gy = v.yRoost != null ? v.yRoost : v.inside && home && !home.cat.confines ? home.y + home.group.userData.fl + 0.03 : H(v.x, v.z);
      v.y = gy;
      const sc = Math.cbrt(b.massKg / 2.5) * (b.sex === 'rooster' ? 1.08 : 1);
      tmpP.set(v.x, v.y + bob + hopY - v.sit * 0.13 * sc, v.z);
      tmpQ.setFromAxisAngle(UP, v.yaw + (v.act === 'dust' ? 0.4 * Math.sin(now / 1000 * 2 + i) : 0));
      tmpS.set(sc, sc, sc);
      tmpM.compose(tmpP, tmpQ, tmpS);
      flockMesh.setMatrixAt(i, tmpM);
      iPose.setXYZW(i, peck * 1.05 - look * 0 + (wantSit > 0.9 ? 0.25 : 0), v.sit, v.flap, moving ? v.gait : 0);
      i++;
    }
    flockMesh.instanceMatrix.needsUpdate = true; iPose.needsUpdate = true;
    // eggs in the nests
    let k = 0;
    const perNest = {};
    for (const egg of s.eggs) {
      if (k >= 48) break;
      const e = egg.nestId && fxById[egg.nestId];
      if (!e) continue;
      const n = (perNest[e.id] = (perNest[e.id] || 0) + 1) - 1;
      let x, z, y;
      if (e.cat.movable) { [x, z] = toWorld(e, 0.45 - (n % 4) * 0.06, -e.cat.dims.d / 3 + 0.1 + Math.floor(n / 4) * 0.06); y = e.y + 0.5; }
      else { const u = e.group.userData, slot = u.slots[n % 2], m = Math.floor(n / 2); [x, z] = toWorld(e, slot + ((m % 3) - 1) * 0.07, ((Math.floor(m / 3) % 2) - 0.5) * 0.08); y = e.y + u.y + 0.02 * Math.floor(m / 6); }
      tmpP.set(x, y, z); tmpQ.setFromAxisAngle(UP, n); tmpS.set(1, 1, 1); tmpM.compose(tmpP, tmpQ, tmpS);
      eggMesh.setMatrixAt(k, tmpM);
      const hen = s.birds[egg.hen], col = EGG_COL[(hen && API.BREEDS[hen.breed].eggColour) || 'brown'];
      eggMesh.instanceColor.setXYZ(k, col[0], col[1], col[2]);
      k++;
    }
    eggMesh.count = k; eggMesh.instanceMatrix.needsUpdate = true; eggMesh.instanceColor.needsUpdate = true;
  }
  function setLook(i, b) {
    const c1 = b.colour || [0.8, 0.5, 0.3], c2 = b.colour2 || [0.2, 0.1, 0.1];
    iCol1.setXYZ(i, c1[0], c1[1], c1[2]); iCol2.setXYZ(i, c2[0], c2[1], c2[2]);
    const cock = b.sex === 'rooster';
    iLook.setXYZW(i, b.pattern || 0, cock ? 1.9 : 1, cock ? 1.9 : 1, b.comb === 'rose' ? 1 : 0);
    iCol1.needsUpdate = iCol2.needsUpdate = iLook.needsUpdate = true;
    const v = vb.get(b.id); if (v) v.lookKey = b.plumage + b.sex + b.comb;
  }
  // a bird's instance slot follows the order of sim.birds, so looks are refreshed when the roster changes
  let rosterSig = '';
  function frame() {
    try {
      const s = CK();
      const sig = s ? Object.keys(s.birds).join() : '';
      if (sig !== rosterSig) { rosterSig = sig; if (s) Object.values(s.birds).forEach((b, i) => i < MAX && setLook(i, b)); for (const id of [...vb.keys()]) if (!s || !s.birds[id]) vb.delete(id); }
      update();
    } catch (e) { console.warn('chickens view', e); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ================= the Chickens panel ================= */
  const panel = $('ck'), body = $('ckbody'), note = $('cknote');
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const run = (name, p) => { const r = G.sim.commandNow(name, p || {}); if (G.markStockDirty) G.markStockDirty(); return r; };
  const have = (id) => API.haveItem(G.sim.state, id);
  const money = (v) => '$' + v.toFixed(v % 1 ? 2 : 0);
  let buyBreed = 'rir', buyCount = 3, buyAge = 18, buySex = 'hen', sig = '';
  function say(t, cls) { note.textContent = t; note.className = 'cknote ' + (cls || ''); }
  function view() {
    const s = CK(), birds = Object.values(s.birds), fx = fixturesNow();
    const coops = fx.filter((e) => e.cat.shelter && !e.cat.movable), tractors = fx.filter((e) => e.cat.movable);
    const feeders = fx.filter((e) => e.cat.feedCapKg), waterers = fx.filter((e) => e.cat.waterCapL);
    const open = coops.some((e) => s.fx[e.id] && s.fx[e.id].doorOpen);
    const lit = coops.some((e) => s.fx[e.id] && s.fx[e.id].light && s.fx[e.id].light.on);
    const feedCap = feeders.reduce((a, e) => a + e.cat.feedCapKg, 0), waterCap = waterers.reduce((a, e) => a + e.cat.waterCapL, 0);
    let h = '<div class="ckstats"><span><b>' + birds.length + '</b> bird' + (birds.length === 1 ? '' : 's') + '</span><span>Feed <b>' + s.flock.feedKg.toFixed(1) + '</b> / ' + feedCap + ' kg</span><span>Water <b>' + s.flock.waterL.toFixed(1) + '</b> / ' + waterCap + ' L</span><span>Eggs today <b>' + s.flock.eggsToday + '</b></span><span>In the pantry <b>' + have('egg') + '</b></span></div>';
    if (fx.length) {
      h += '<div class="ckchores">';
      if (coops.length) h += '<button type="button" data-act="door" class="' + (open ? '' : 'hot') + '">' + (open ? 'Shut the door' : 'Let them out') + '</button>';
      const feed = have('layer_feed');
      h += '<button type="button" data-act="feed" class="' + (s.flock.feedKg < 0.3 * feedCap ? 'hot' : '') + '">' + (feed > 0.01 ? 'Fill the feeder' : 'Buy 20 kg feed and fill') + '<small>' + (feed > 0.01 ? feed.toFixed(1) + ' kg in stock' : money(20 * API.ITEMS_CHICKENS.layer_feed.priceUsd)) + '</small></button>';
      h += '<button type="button" data-act="water" class="' + (s.flock.waterL < 0.3 * waterCap ? 'hot' : '') + '">Fresh water</button>';
      h += '<button type="button" data-act="eggs" class="' + (s.eggs.length ? 'hot' : '') + '"' + (s.eggs.length ? '' : ' disabled') + '>Collect ' + (s.eggs.length ? s.eggs.length + ' egg' + (s.eggs.length > 1 ? 's' : '') : 'eggs') + '</button>';
      if (coops.length) h += '<button type="button" data-act="light">Coop light: ' + (lit ? 'on, 15 h' : 'off') + '</button>';
      if (tractors.length) h += '<button type="button" data-act="tractor">Move the tractor</button>';
      h += '</div>';
    }
    if (s.issues.length) { h += '<div class="ckissues">'; for (const i of s.issues) h += '<div class="ckissue ' + i.severity + '">' + esc(i.reason) + ' <small>' + esc(i.fix) + '</small></div>'; h += '</div>'; }
    if (birds.length) {
      h += '<h3>Your flock</h3>';
      for (const b of birds) {
        const wk = Math.floor(((G.sim.state.lifeT ?? G.sim.state.t) - b.bornT) / 86400 / 7);
        const c = b.colour || [0.5, 0.5, 0.5], css = 'rgb(' + c.map((x) => Math.round(x * 255)).join(',') + ')';
        h += '<div class="ckbird"><span class="dot" style="background:' + css + '"></span><div class="name">' + esc(b.name) + '<small>' + esc(b.breedName) + (b.sex === 'rooster' ? ' rooster' : '') + ', ' + (wk < 52 ? wk + ' weeks' : (wk / 52).toFixed(1) + ' years') + ', ' + b.massKg.toFixed(2) + ' kg, ' + esc(b.personality) + ' · ' + b.eggs.laidTotal + ' eggs</small><span class="st">' + esc(b.status) + '</span></div><span class="mood ' + b.mood + '">' + b.mood + '</span></div>';
      }
    }
    h += '<h3>' + (fx.length ? 'More' : 'Get started') + '</h3><div class="ckrow">';
    if (!coops.length) h += '<button type="button" data-act="starter" class="hot">Set up a coop here<small>coop, feeder, water, nest box</small></button>';
    else h += '<button type="button" data-act="starter">Another coop here</button>';
    h += '<button type="button" data-act="placeTractor">Chicken tractor here</button>';
    if (coops.length) h += '<button type="button" data-act="straw">Add straw</button><button type="button" data-act="clean">Muck out the coop</button>';
    h += '</div><div class="ckbuy"><select id="ckbreed">' + Object.values(API.BREEDS).map((b) => '<option value="' + b.id + '"' + (b.id === buyBreed ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') + '</select>';
    h += '<select id="cksex"><option value="hen"' + (buySex === 'hen' ? ' selected' : '') + '>hens</option><option value="rooster"' + (buySex === 'rooster' ? ' selected' : '') + '>rooster</option></select>';
    h += '<select id="ckage"><option value="10"' + (buyAge === 10 ? ' selected' : '') + '>10 weeks (growing)</option><option value="18"' + (buyAge === 18 ? ' selected' : '') + '>18 weeks (about to lay)</option><option value="30"' + (buyAge === 30 ? ' selected' : '') + '>30 weeks (laying)</option></select>';
    h += '<button type="button" data-act="less">−</button><span class="n">' + buyCount + '</span><button type="button" data-act="more">+</button>';
    const it = API.ITEMS_CHICKENS[buySex === 'rooster' ? 'chicken_rooster' : buyAge < 16 ? 'chicken_started' : buyAge < 26 ? 'chicken_pullet' : 'chicken_hen'];
    h += '<button type="button" data-act="buy" class="go">Buy for ' + money(it.priceUsd * buyCount) + '</button></div>';
    const br = API.BREEDS[buyBreed];
    h += '<div class="ckblurb">' + esc(br.blurb) + ' About ' + br.eggsPerYear + ' ' + br.eggColour + ' eggs a year; ' + br.henKg + ' kg. ' + esc(br.temperament) + '. ' + esc(br.cold) + '.</div>';
    return h;
  }
  function render() {
    const a = document.activeElement;
    if (a && a.tagName === 'SELECT' && body.contains(a)) return;
    const sc = body.scrollTop; body.innerHTML = view(); body.scrollTop = sc;
    $('ckmoney').textContent = money(G.sim.state.sys.stock.money);
  }
  const signature = () => { const s = CK(); return JSON.stringify([s.flock, s.issues.length, s.eggs.length, Object.values(s.birds).map((b) => b.status + b.mood), Object.values(s.fx).map((f) => [f.doorOpen, f.light && f.light.on]), s.own.length, G.sim.state.sys.stock.money]); };
  let poll = 0;
  function openPanel() { panel.hidden = false; if (document.pointerLockElement) document.exitPointerLock(); say(''); render(); clearInterval(poll); poll = setInterval(() => { const g = signature(); if (!panel.hidden && g !== sig) { sig = g; render(); } }, 500); }
  function closePanel() { panel.hidden = true; clearInterval(poll); const c = $('view'); if (c) c.focus(); }
  const toggle = () => (panel.hidden ? openPanel() : closePanel());
  $('ckb').addEventListener('click', toggle);
  $('ckclose').addEventListener('click', closePanel);
  // H ("Hens"). Listened for in the capture phase so the engine's old H (show the controls) does not also fire.
  window.addEventListener('keydown', (e) => {
    const t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Escape' && !panel.hidden) { closePanel(); return; }
    if (G.player.tool === 'build' || e.code !== 'KeyH') return;
    e.stopImmediatePropagation();
    if (!e.repeat) toggle();
  }, true);
  function inFront(dist) { const f = G.player.face; return { x: G.player.x + Math.sin(f) * dist, z: G.player.z + Math.cos(f) * dist, yawRad: f + Math.PI }; }
  function place(list) {
    if (typeof G.addFixtures === 'function') return G.addFixtures(list);
    return run('chickens.placeFixtures', { pieces: list });
  }
  body.addEventListener('change', (e) => {
    if (e.target.id === 'ckbreed') buyBreed = e.target.value;
    if (e.target.id === 'cksex') { buySex = e.target.value; if (buySex === 'rooster') buyCount = 1; }
    if (e.target.id === 'ckage') buyAge = +e.target.value;
    e.target.blur(); render();
  });
  body.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const s = CK(), act = b.dataset.act;
    let r;
    if (act === 'door') { const open = !fixturesNow().some((x) => x.cat.door && s.fx[x.id] && s.fx[x.id].doorOpen); r = run('chickens.setDoor', { open }); say(open ? 'Door open. Out they come.' : 'Door shut.', 'good'); }
    else if (act === 'feed') {
      if (have('layer_feed') < 0.01) { r = run('chickens.buySupply', { id: 'layer_feed', qty: 20 }); if (!r.ok) { say(r.reason === 'not enough money' ? 'Not enough money for feed.' : 'Could not buy feed: ' + r.reason, 'bad'); render(); return; } }
      r = run('chickens.fillFeeder', {}); say(r.ok ? 'Filled the feeder with ' + r.kg.toFixed(1) + ' kg. They come running.' : 'The feeder is ' + (r.reason || '').replace('the feeder is ', '') + '.', r.ok ? 'good' : '');
    } else if (act === 'water') { r = run('chickens.fillWaterer', {}); say(r.ok ? 'Fresh water: ' + r.litres.toFixed(1) + ' L.' : 'The water is ' + (r.reason || '').replace('the waterer is ', '') + '.', r.ok ? 'good' : ''); }
    else if (act === 'eggs') { r = run('chickens.collectEggs', {}); say(r.count ? 'Collected ' + r.count + ' egg' + (r.count > 1 ? 's' : '') + '. Still warm.' : 'No eggs yet.', 'good'); }
    else if (act === 'light') { const on = !fixturesNow().some((x) => x.cat.shelter && s.fx[x.id] && s.fx[x.id].light && s.fx[x.id].light.on); r = run('chickens.setLight', { on, hours: 15 }); say(on ? 'The coop light comes on before dawn to give 15 hours of light. Hens lay through the winter.' : 'Light off: the hens follow the seasons.', 'good'); }
    else if (act === 'tractor') { r = run('chickens.moveTractor', {}); say(r.ok ? 'Moved the tractor onto fresh grass.' : r.reason, r.ok ? 'good' : 'bad'); }
    else if (act === 'starter') { const p = inFront(5); r = place(API.starterFixtures(p.x, p.z, p.yawRad)); say('A coop with a feeder, a water fount and a nest box, just in front of you. Fill them, then buy some hens.', 'good'); }
    else if (act === 'placeTractor') { const p = inFront(5); r = place([{ fixture: 'chicken_tractor', x: p.x, z: p.z, yawRad: p.yawRad }]); say('A chicken tractor. Hens you buy next can live in it: move it every day or two.', 'good'); }
    else if (act === 'straw') { if (have('straw_bedding') < 5) run('chickens.buySupply', { id: 'straw_bedding', qty: 5 }); r = run('chickens.addBedding', { kg: 5 }); say(r.ok ? 'Fresh straw on the coop floor.' : r.reason, r.ok ? 'good' : 'bad'); }
    else if (act === 'clean') { r = run('chickens.cleanCoop', {}); say(r.ok ? 'Mucked out ' + r.kg.toFixed(1) + ' kg of litter (' + (r.nKg * 1000).toFixed(0) + ' g of nitrogen) for the compost.' : r.reason, r.ok ? 'good' : 'bad'); }
    else if (act === 'less' || act === 'more') { buyCount = clamp(buyCount + (act === 'more' ? 1 : -1), 1, 12); }
    else if (act === 'buy') { r = run('chickens.buy', { breed: buyBreed, count: buyCount, ageWeeks: buyAge, sex: buySex }); say(r.ok ? 'Welcome, ' + r.ids.map((id) => CK().birds[id].name).join(', ') + '!' : 'Could not buy: ' + r.reason + '.', r.ok ? 'good' : 'bad'); }
    render();
  });

  window.__chickensView = {
    open: openPanel, close: closePanel, get isOpen() { return !panel.hidden; },
    info: () => ({ birds: flockMesh.count, eggs: eggMesh.count, fixtures: fxList.length }),
    // test hook: where each bird is drawn this frame
    positions: () => [...vb.entries()].map(([id, v]) => ({ id, x: v.x, y: v.y, z: v.z, sit: v.sit, act: v.act })),
    bench: (n = 200) => { const t0 = performance.now(); for (let i = 0; i < n; i++) update(); return (performance.now() - t0) / n; },
  };
})();
