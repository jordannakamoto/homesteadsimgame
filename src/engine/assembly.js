// Assembly: putting a ghost together piece by piece. Generic: it draws box-shaped members that have gone in but
// have not been handed back to whoever owns the finished thing, glows the ones that can go in next, lets a frame
// be put together lying down and swung upright about an edge, runs the hold-to-work rhythm, and makes the sounds.
// It knows nothing about what is being built.
//   window.__assembly.create(G, { geo, mat, colorOf(member) }) -> assembly
//   a member: { id, a: [x, y, z], b: [x, y, z], n: [x, y, z], section: { b, d } }   (ends of its centre line; n: the way its depth lies)
(() => {
  function create(G, look) {
    const T = G.THREE,
      glowMat = new T.MeshBasicMaterial({ color: 0x9fecff, transparent: true, opacity: 0.45, depthWrite: false, fog: false }),
      // the faint glow on everything that can go in next, seen from anywhere: slower and quieter than the glow within reach
      farMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false, fog: false }),
      things = new Map(),
      dotGeo = new T.BoxGeometry(1, 1, 1), dotMat = new T.MeshBasicMaterial({ color: 0xffffff, fog: false }),
      // the nails are cut by the dollhouse planes like the pieces they are in: a material per building that has planes
      dotMatFor = (t) => { const pl = t.mats && t.mats.mat && t.mats.mat.clippingPlanes; if (!pl) return dotMat; if (!t.dotMat || t.dotMat.clippingPlanes !== pl) t.dotMat = new T.MeshBasicMaterial({ color: 0xffffff, fog: false, clippingPlanes: pl, clipIntersection: t.mats.mat.clipIntersection }); return t.dotMat; },
      m4 = new T.Matrix4(), m4b = new T.Matrix4(), v = new T.Vector3(), c = new T.Color(), up = new T.Vector3(0, 1, 0);
    let pulse = 0;
    // the box that is a member: columns along it, across its depth, across its breadth (the same as its owner draws it)
    function matrixOf(m, out, grow = 0, lift = null, h = 0) {   // lift: the direction (and, times h, the distance) it is held clear along
      const ax = m.b[0] - m.a[0], ay = m.b[1] - m.a[1], az = m.b[2] - m.a[2], L = Math.hypot(ax, ay, az) || 1,
        d = m.section.d + grow, b = (m.section.b + grow) / L, nx = m.n[0], ny = m.n[1], nz = m.n[2],
        lx = lift ? lift.x * h : 0, ly = lift ? lift.y * h : 0, lz = lift ? lift.z * h : 0;
      return out.set(ax, nx * d, (ay * nz - az * ny) * b, (m.a[0] + m.b[0]) / 2 + lx, ay, ny * d, (az * nx - ax * nz) * b, (m.a[1] + m.b[1]) / 2 + ly, az, nz * d, (ax * ny - ay * nx) * b, (m.a[2] + m.b[2]) / 2 + lz, 0, 0, 0, 1);
    }
    function thing(key) {
      let t = things.get(key);
      if (!t) {
        t = { root: new T.Group(), layers: new Map() };
        t.root.matrixAutoUpdate = false;
        G.scene.add(t.root);
        things.set(key, t);
      }
      return t;
    }
    function layer(key, id, cap = 64) {
      const t = thing(key);
      let L = t.layers.get(id);
      if (L && L.cap < cap) { dropLayer(t, id); L = null; }
      if (!L) {
        L = { cap, dots: null, group: new T.Group(), solid: new T.InstancedMesh(look.geo, (t.mats && t.mats.mat) || look.mat, cap), glow: new T.InstancedMesh(look.geo, glowMat, cap), at: new Map(), list: [], pivot: new T.Vector3(), lift: new T.Vector3(0, 1, 0), angle: 0, axis: new T.Vector3(1, 0, 0) };
        L.solid.castShadow = L.solid.receiveShadow = true;
        L.solid.count = L.glow.count = 0;
        // members the look draws with its other material (lap siding): their own mesh, the same box
        if (look.alt) { L.alt = new T.InstancedMesh(look.geo, (t.mats && t.mats.alt) || look.alt.mat, cap); L.alt.castShadow = L.alt.receiveShadow = true; L.alt.count = 0; L.alt.frustumCulled = false; L.group.add(L.alt); }
        L.solid.frustumCulled = L.glow.frustumCulled = false;
        L.glow.renderOrder = 4;
        L.group.add(L.solid, L.glow);
        t.root.add(L.group);
        t.layers.set(id, L);
      }
      return L;
    }
    function dropLayer(t, id) {
      const L = t.layers.get(id);
      if (!L) return;
      t.root.remove(L.group); L.solid.dispose(); L.alt && L.alt.dispose(); L.glow.dispose(); L.dots && L.dots.dispose(); L.far && L.far.dispose(); t.layers.delete(id);
    }
    const local = (L, m, out, grow, h, dir) => { matrixOf(m, out, grow, dir ? v.set(dir[0], dir[1], dir[2]) : L.lift, h); out.elements[12] -= L.pivot.x; out.elements[13] -= L.pivot.y; out.elements[14] -= L.pivot.z; return out; };
    return {
      // the materials this thing's pieces are drawn with ({ mat, alt }), in place of the look's (a building's own, cut open
      // when you are inside it); null goes back to the look's
      setMats(key, mats) {
        const t = thing(key);
        if (t.mats === mats || (t.mats && mats && t.mats.mat === mats.mat && t.mats.alt === mats.alt)) return;
        t.mats = mats;
        for (const L of t.layers.values()) { L.solid.material = (mats && mats.mat) || look.mat; if (L.alt) L.alt.material = (mats && mats.alt) || look.alt.mat; if (L.dots) L.dots.material = dotMatFor(t); }
      },
      setFrame(key, matrix) { const t = thing(key); t.root.matrix.copy(matrix); t.root.matrixWorldNeedsUpdate = true; },
      remove(key) { const t = things.get(key); if (!t) return; for (const id of [...t.layers.keys()]) dropLayer(t, id); G.scene.remove(t.root); things.delete(key); },
      keys: () => [...things.keys()],
      dropLayer(key, id) { const t = things.get(key); t && dropLayer(t, id); },
      // a layer that swings about a line: pivot a point on it, axis its direction, angle how far it is laid over
      hinge(key, id, pivot, axis, angle, cap) {
        const L = layer(key, id, cap);
        L.pivot.set(pivot[0], pivot[1], pivot[2]); L.axis.set(axis[0], axis[1], axis[2]).normalize();
        L.group.position.copy(L.pivot);
        this.swing(key, id, angle);
        return L;
      },
      swing(key, id, angle) {
        const L = layer(key, id);
        L.angle = angle;
        L.group.quaternion.setFromAxisAngle(L.axis, angle);
        // "up" as the pieces of this layer see it while it lies over: the way a piece is lifted clear before it is knocked in
        L.lift.copy(up).applyQuaternion(L.group.quaternion.clone().invert());
      },
      // the members drawn solid in a layer (all of them, each time: a layer is small)
      setSolid(key, id, members, cap) {
        const L = layer(key, id, Math.max(cap || 0, members.length, 16));
        L.at.clear(); L.list = members; L.slot = [];
        let ns = 0, na = 0;
        members.forEach((m, n) => {
          L.at.set(m.id, n);
          const alt = !!(L.alt && look.alt.test(m)), mesh = alt ? L.alt : L.solid, i = alt ? na++ : ns++;
          L.slot[n] = [mesh, i];
          mesh.setMatrixAt(i, local(L, m, m4, 0, 0));
          const k = look.colorOf(m), s = /^siding/.test(m.col || '') ? 0.98 + 0.04 * ((n * 7919) % 13) / 13 : 0.92 + 0.16 * ((n * 7919) % 13) / 13;
          mesh.setColorAt(i, c.setRGB(k[0] * s, k[1] * s, k[2] * s));
        });
        for (const [mesh, k] of [[L.solid, ns], [L.alt, na]]) {
          if (!mesh) continue;
          mesh.count = k; mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      },
      // hold one solid member h metres clear of its seat (it is being knocked in)
      // dir (optional): a vector to hold it away along, in place of "up" (a board slides in along its wall)
      lift(key, id, memberId, h, dir) {
        const L = layer(key, id), n = L.at.get(memberId);
        if (n === undefined) return;
        const [mesh, i] = L.slot[n];
        mesh.setMatrixAt(i, local(L, L.list[n], m4, 0, h, dir));
        mesh.instanceMatrix.needsUpdate = true;
      },
      // a sheet laid out along its width: only the first fraction f of it (from its low end along n) is there; it is held h clear along dir
      unfurl(key, id, memberId, f, h, dir) {
        const L = layer(key, id), n = L.at.get(memberId);
        if (n === undefined) return;
        const mm = L.list[n], e = local(L, mm, m4, 0, h, dir).elements, sh = -(1 - f) * mm.section.d / 2;
        e[4] *= f; e[5] *= f; e[6] *= f;
        e[12] += mm.n[0] * sh; e[13] += mm.n[1] * sh; e[14] += mm.n[2] * sh;
        const [mesh, i] = L.slot[n];
        mesh.setMatrixAt(i, m4);
        mesh.instanceMatrix.needsUpdate = true;
      },
      // nail points: small boxes that ride with the layer. list: [{ p: [x, y, z], k: 0 (bright, waiting) | 1 (driven, dark) }]
      setDots(key, id, list) {
        const L = layer(key, id, 16);
        if (!L.dots || L.dots.instanceMatrix.count < list.length) {
          if (L.dots) { L.group.remove(L.dots); L.dots.dispose(); }
          if (!list.length) return;
          L.dots = new T.InstancedMesh(dotGeo, dotMatFor(thing(key)), Math.max(256, list.length * 2));
          L.dots.frustumCulled = false; L.dots.renderOrder = 5;
          L.group.add(L.dots);
        }
        if (!L.dots) return;
        list.forEach((d, n) => {
          const sz = d.k ? 0.014 : 0.05;      // a driven nail's head, small; one still to drive, a bright marker
          const h = d.h || 0;
          L.dots.setMatrixAt(n, m4.makeScale(sz, sz, sz).setPosition(d.p[0] + L.lift.x * h - L.pivot.x, d.p[1] + L.lift.y * h - L.pivot.y, d.p[2] + L.lift.z * h - L.pivot.z));
          L.dots.setColorAt(n, d.k ? c.setRGB(0.1, 0.09, 0.08) : c.setRGB(1, 0.86, 0.3));
        });
        L.dots.count = list.length;
        L.dots.instanceMatrix.needsUpdate = true;
        if (L.dots.instanceColor) L.dots.instanceColor.needsUpdate = true;
      },
      setGlow(key, id, members) {
        const L = layer(key, id, Math.max(members.length, 16));
        members.forEach((m, n) => L.glow.setMatrixAt(n, local(L, m, m4b, 0.012, 0)));
        L.glow.count = members.length;
        L.glow.instanceMatrix.needsUpdate = true;
      },
      // the faint glow: members with a colour each ([r, g, b]); the same boxes as the glow, a little fuller
      setFar(key, id, members, colors) {
        const L = layer(key, id, 16);
        if (!L.far || L.far.instanceMatrix.count < members.length) {
          if (L.far) { L.group.remove(L.far); L.far.dispose(); L.far = null; }
          if (!members.length) return;
          L.far = new T.InstancedMesh(look.geo, farMat, Math.max(64, members.length + 32));
          L.far.frustumCulled = false; L.far.renderOrder = 3;
          L.group.add(L.far);
        }
        members.forEach((m, n) => { L.far.setMatrixAt(n, local(L, m, m4b, 0.02, 0)); const k = colors[n]; L.far.setColorAt(n, c.setRGB(k[0], k[1], k[2])); });
        L.far.count = members.length;
        L.far.instanceMatrix.needsUpdate = true;
        if (L.far.instanceColor) L.far.instanceColor.needsUpdate = true;
      },
      // where a member's box is drawn just now, in its layer (for tests)
      drawnAt(key, id, memberId) { const t = things.get(key), L = t && t.layers.get(id), n = L && L.at.get(memberId); if (n === undefined) return null; L.slot[n][0].getMatrixAt(L.slot[n][1], m4); return [m4.elements[12], m4.elements[13], m4.elements[14]]; },
      // where a member is in the world right now (its middle), for sparks and dust
      worldOf(key, id, m, out) {
        const t = things.get(key), L = t && t.layers.get(id);
        out.set((m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2, (m.a[2] + m.b[2]) / 2);
        if (!L) return out;
        out.sub(L.pivot).applyQuaternion(L.group.quaternion).add(L.pivot);
        return out.applyMatrix4(t.root.matrix);
      },
      update(dt) { pulse += dt; glowMat.opacity = 0.34 + 0.2 * Math.sin(pulse * 4.2); farMat.opacity = 0.13 + 0.07 * Math.sin(pulse * 1.7); },
    };
  }

  // Hold-to-work: a job is a number of blows; each blow calls back, the last one finishes the job.
  //   worker.begin({ beats, data }), worker.tick(dt, speed) -> advances; worker.cancel()
  function createWorker({ beatS, onBeat, onDone, onCancel }) {
    const W = { job: null, t: 0, beat: 0 };
    W.begin = (job) => { W.job = job; W.t = beatS * 0.55; W.beat = 0; };
    W.cancel = () => { const j = W.job; W.job = null; j && onCancel && onCancel(j); };
    W.tick = (dt, speed = 1) => {
      if (!W.job) return;
      W.t += dt * speed;
      while (W.job && W.t >= beatS) {
        W.t -= beatS; W.beat++;
        const j = W.job, last = W.beat >= j.beats;
        onBeat && onBeat(j, W.beat, last);
        if (last) { W.job = null; onDone && onDone(j); }
      }
    };
    // 0..1 through the present job, eased within each blow so that a piece drops a little at every one
    W.progress = () => (W.job ? Math.min(1, (W.beat + Math.min(1, W.t / beatS) ** 3) / W.job.beats) : 0);
    return W;
  }

  // Small percussive sounds made on the spot: no files. Quiet, a little different each time.
  function createSounds() {
    let ctx = null, noise = null, master = null, muted = false, last = 0;
    function ready() {
      if (ctx) return ctx.state === 'running' || (ctx.resume && ctx.resume(), ctx.state === 'running');
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
        noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (err) { ctx = null; return false; }
      return ctx.state === 'running';
    }
    const env = (g, t, peak, dur) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); };
    function tone(f0, f1, dur, peak, type = 'sine') {
      const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      env(g, t, peak, dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
    }
    function hiss(freq, qv, dur, peak, type = 'bandpass', sweep = 1) {
      const t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noise; s.loop = true; f.type = type; f.Q.value = qv; f.frequency.setValueAtTime(freq, t); if (sweep !== 1) f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
      env(g, t, peak, dur); s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random() * 0.3); s.stop(t + dur + 0.02);
    }
    const r = (a, b) => a + Math.random() * (b - a);
    const KIND = {
      knock: (k) => { tone(r(230, 290) * k, 150, 0.07, 0.5, 'triangle'); hiss(r(1500, 2300), 2.5, 0.045, 0.32); },             // wood on wood
      seat: () => { tone(r(150, 180), 90, 0.12, 0.6, 'triangle'); hiss(900, 1.5, 0.06, 0.3); },                              // the last blow: lower, it is home
      thunk: () => { tone(r(105, 130), 60, 0.14, 0.7); hiss(420, 0.8, 0.09, 0.3, 'lowpass'); },                               // a sheet laid down
      scrape: () => { hiss(r(500, 700), 1.2, 0.26, 0.2, 'bandpass', 0.55); tone(85, 60, 0.1, 0.3); },                          // a block dragged into place
      rustle: () => hiss(r(3200, 4200), 0.7, 0.16, 0.12, 'highpass'),                                                         // wrap, felt, batts
      dig: () => { hiss(r(260, 340), 0.9, 0.2, 0.3, 'lowpass', 0.6); tone(70, 50, 0.08, 0.25); },
      thud: () => { tone(82, 38, 0.34, 0.95); hiss(180, 0.7, 0.2, 0.4, 'lowpass'); },                                         // something heavy lands
      creak: () => tone(r(260, 330), r(380, 430), 0.22, 0.05, 'sawtooth'),
      lift: () => hiss(1200, 0.6, 0.12, 0.08, 'bandpass', 1.6),
      chime: () => { tone(659, 659, 0.5, 0.16); setTimeout(() => ctx && tone(880, 880, 0.7, 0.14), 130); setTimeout(() => ctx && tone(1319, 1319, 0.9, 0.08), 270); },
    };
    return {
      play(kind, k = 1) { last = kind; if (muted || !ready()) return; try { (KIND[kind] || KIND.knock)(k); } catch (err) { /* sound is never worth an error */ } },
      wake() { ready(); },
      set muted(v) { muted = !!v; }, get muted() { return muted; }, get last() { return last; },
    };
  }
  window.__assembly = { create, createWorker, createSounds };
})();
