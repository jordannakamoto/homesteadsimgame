// Cut station: a pair of sawhorses, a stick laid across them, a saw that strokes through it, sawdust, the offcut falling
// to a pile and the sawn piece handed on to where it goes. Generic: it knows sticks, lengths and saws, not buildings.
//   window.__cutStation.create(G) -> station
//   station.setHorses({ x, z, yaw } | null)   where the horses stand (yaw: the way a stick lies across them)
//   station.setPile(n)                        how many kept offcuts lie by the horses
//   station.cut(job, done)                    queue a cut: { stockM, lenM, sawn, keptM, onHorses, x, z, yaw (when not on the horses),
//                                             to: { x, y, z } where the piece goes, power, slow, w, h (its section, default a 2x4),
//                                             color (of the piece), dust (colour of the sawdust) }; done() when the piece has gone
//   station.update(dt) -> { x, z, k } of the cut in hand (k: 0..1 through a stroke), or null when idle
//   station.near(x, z, r)                     are the horses within r of (x, z)
(() => {
  function create(G) {
    const T = G.THREE,
      wood = new T.MeshLambertMaterial({ color: 0xb8925f }),
      stick = new T.MeshLambertMaterial({ color: 0xdcbc8c }),
      steel = new T.MeshLambertMaterial({ color: 0xaab0b6 }),
      grip = new T.MeshLambertMaterial({ color: 0x8c3b2a }),
      box = new T.BoxGeometry(1, 1, 1),
      part = (parent, mat, sx, sy, sz, x, y, z, rx = 0, rz = 0) => { const m = new T.Mesh(box, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); m.castShadow = true; parent.add(m); return m; };
    // ---- the horses: an A-frame trestle each, 0.7 m tall, 1.1 m apart along the stick
    const horses = new T.Group();
    for (const s of [-0.55, 0.55]) {
      const h = new T.Group();
      h.position.z = s;
      part(h, wood, 0.8, 0.07, 0.07, 0, 0.68, 0);
      for (const x of [-0.32, 0.32]) for (const z of [-1, 1]) part(h, wood, 0.05, 0.72, 0.05, x * 1.08, 0.33, z * 0.09, z * 0.22, -Math.sign(x) * 0.12);
      horses.add(h);
    }
    horses.visible = false;
    G.scene.add(horses);
    // ---- the stick being cut (two boxes: the piece and the offcut), the saw, the pile of offcuts
    const cutMat = stick.clone(), piece = part(G.scene, cutMat, 0.089, 0.038, 1, 0, 0, 0), off = part(G.scene, cutMat, 0.089, 0.038, 1, 0, 0, 0);
    piece.visible = off.visible = false;
    const saw = new T.Group();
    part(saw, steel, 0.004, 0.11, 0.55, 0, 0, 0);
    part(saw, grip, 0.03, 0.12, 0.12, 0, 0.02, -0.32);
    const disc = new T.Mesh(new T.CylinderGeometry(0.09, 0.09, 0.006, 18).rotateZ(Math.PI / 2), steel);
    const body = part(saw, grip, 0.12, 0.12, 0.22, 0.07, 0.06, 0);
    saw.add(disc);
    saw.visible = false;
    G.scene.add(saw);
    const pile = new T.InstancedMesh(box, stick, 12);
    pile.count = 0; pile.castShadow = true; pile.frustumCulled = false;
    G.scene.add(pile);
    const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), v = new T.Vector3(), sc = new T.Vector3(), up = new T.Vector3(0, 1, 0);
    let at = null, pileN = -1, job = null, drop = null;
    const queue = [];
    const H = 0.735;                                    // the top of a horse, where a stick lies
    function setHorses(h) {
      const sig = h ? h.x + ',' + h.z + ',' + h.yaw : '';
      if (sig === (at ? at.sig : '')) return;
      at = h ? { ...h, sig } : null;
      horses.visible = !!at;
      if (at) { horses.position.set(at.x, G.heightAt(at.x, at.z), at.z); horses.rotation.y = at.yaw; }
      pileN = -1;
    }
    function setPile(n) {
      n = Math.max(0, Math.min(12, n | 0));
      if (n === pileN) return;
      pileN = n;
      if (!at) { pile.count = 0; return; }
      const c = Math.cos(at.yaw), s = Math.sin(at.yaw), gy = G.heightAt(at.x, at.z);
      for (let i = 0; i < n; i++) {
        // short sticks in a loose heap beside the far horse
        const lx = 0.62 + ((i * 37) % 5) * 0.07, lz = -0.9 + ((i * 53) % 7) * 0.06, len = 0.3 + ((i * 29) % 9) * 0.07;
        e.set(0, ((i * 71) % 13) * 0.21, 0); q.setFromEuler(e);
        v.set(at.x + lx * c + lz * s, gy + 0.02 + Math.floor(i / 4) * 0.04, at.z - lx * s + lz * c);
        pile.setMatrixAt(i, m4.compose(v, q.multiply(new T.Quaternion().setFromAxisAngle(up, at.yaw)), sc.set(0.089, 0.038, len)));
      }
      pile.count = n;
      pile.instanceMatrix.needsUpdate = true;
    }
    function cut(j, done) { queue.push({ ...j, done }); }
    // a stick lying along u at height y, with the cut at c (world), the piece behind it and the offcut beyond
    function lay(j) {
      const u = [Math.sin(j.yaw), Math.cos(j.yaw)], kept = j.lenM, rest = Math.max(0, j.stockM - j.lenM);
      j.u = u;
      j.piece = [j.cx - u[0] * kept / 2, j.cy, j.cz - u[1] * kept / 2];
      j.off = rest > 0.01 ? [j.cx + u[0] * rest / 2, j.cy, j.cz + u[1] * rest / 2] : null;
      const sw = j.w || 0.089, sh = j.h || 0.038;
      cutMat.color.setHex(j.color === undefined ? 0xdcbc8c : j.color);
      piece.scale.set(sw, sh, kept); piece.rotation.set(0, j.yaw, 0); piece.position.set(...j.piece); piece.visible = true;
      off.visible = !!j.off;
      if (j.off) { off.scale.set(sw, sh, rest); off.rotation.set(0, j.yaw, 0); off.position.set(...j.off); }
      saw.visible = j.sawn;
      disc.visible = body.visible = !!j.power;
      saw.children[0].visible = saw.children[1].visible = !j.power;
    }
    function start(j) {
      if (j.onHorses && at) {
        const gy = G.heightAt(at.x, at.z), d = 0.75;
        j.yaw = at.yaw; j.cx = at.x + Math.sin(at.yaw) * d; j.cz = at.z + Math.cos(at.yaw) * d; j.cy = gy + H + 0.02;
      } else { j.cy = (j.y !== undefined ? j.y : G.heightAt(j.x, j.z)) + 0.04; j.cx = j.x; j.cz = j.z; }
      // a hand saw takes a few strokes; a circular saw one pass; cutting on the deck, kneeling, is slower than at the horses
      j.dur = (j.sawn ? (j.power ? 0.28 : 0.42) : 0.12) * (j.onHorses ? 1 : 1.5) * (j.slow || 1);
      j.t = 0; j.strokes = j.power ? 1 : 3; j.last = -1;
      lay(j);
      job = j;
    }
    function update(dt) {
      if (drop) {                                         // the offcut tumbling to the ground
        drop.t += dt; drop.vy -= 12 * dt;
        off.position.y = Math.max(drop.floor, off.position.y + drop.vy * dt);
        off.rotation.x += dt * 6 * drop.spin; off.position.x += drop.vx * dt; off.position.z += drop.vz * dt;
        if (off.position.y <= drop.floor + 1e-3 && drop.t > 0.12) { off.visible = false; drop = null; }
      }
      if (!job) { if (!queue.length) return null; start(queue.shift()); }
      const j = job;
      j.t += dt;
      const p = Math.min(1, j.t / j.dur);
      if (p < 0.72 && j.sawn) {                           // strokes through the stick at the cut line
        const k = p / 0.72, stroke = (k * j.strokes) % 1, sw = Math.sin(stroke * Math.PI * 2), dn = k * 0.03;
        const w = [Math.cos(j.yaw), -Math.sin(j.yaw)];
        if (j.power) { saw.position.set(j.cx + w[0] * (0.1 - 0.2 * k), j.cy + 0.06 - dn, j.cz + w[1] * (0.1 - 0.2 * k)); saw.rotation.set(0, j.yaw, 0); disc.rotation.x += dt * 60; }
        else { saw.position.set(j.cx + w[0] * sw * 0.12, j.cy + 0.09 - dn + 0.03 * sw, j.cz + w[1] * sw * 0.12); saw.rotation.set(0.6, j.yaw + Math.PI / 2, 0); }
        const n = Math.floor(k * j.strokes * 2);
        if (n !== j.last) { j.last = n; G.burst(j.cx, j.cy - 0.03, j.cz, j.power ? 4 : 2, j.dust === undefined ? 0xe8d9b0 : j.dust, 0.35, 0.25, 0.035, 0.45); }
        return { x: j.cx, z: j.cz, k: stroke };
      }
      if (j.off && !j.dropped) {                          // the offcut falls away: kept ones go to the pile, short ones are scrap
        j.dropped = true; saw.visible = false;
        drop = { t: 0, vy: 0.4, vx: j.u[0] * 0.6, vz: j.u[1] * 0.6, spin: j.keptM > 0 ? 1 : 1.6, floor: G.heightAt(j.off[0], j.off[2]) + 0.02 };
        G.burst(j.cx, j.cy, j.cz, 3, 0xe8d9b0, 0.4, 0.4, 0.04, 0.35);
      }
      saw.visible = false;
      // the piece goes to its place in a short arc
      const f = j.sawn ? Math.max(0, (p - 0.72) / 0.28) : p, s3 = f * f * (3 - 2 * f), to = j.to || { x: j.cx, y: j.cy, z: j.cz };
      piece.position.set(j.piece[0] + (to.x - j.piece[0]) * s3, j.piece[1] + (to.y - j.piece[1]) * s3 + Math.sin(f * Math.PI) * 0.6, j.piece[2] + (to.z - j.piece[2]) * s3);
      piece.rotation.y = j.yaw + f * 0.6;
      if (p >= 1) { piece.visible = false; job = null; j.done && j.done(); }
      return null;
    }
    return {
      setHorses, setPile, cut, update,
      busy: () => !!job || queue.length > 0,
      near: (x, z, r) => !!at && Math.hypot(x - at.x, z - at.z) <= r,
      get horses() { return at; },
    };
  }
  window.__cutStation = { create };
})();
