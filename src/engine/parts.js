/* Parts view (window.__parts): draws and handles the kit parts of a parts system (src/sim/core/parts.js).
   Generic: it knows nothing about what the parts are for. Content attaches a parts system with shapes and
   a few callbacks; this file does the instanced drawing, picking from a pile, carrying, the ghost with its
   allowed turns, the fit and pull-off gestures, cutting a length by dragging its free end, and the scripted
   tumble-and-settle of anything dropped. All truth stays in the simulation: every action is a command.

   INTERFACE
     const view = __parts.attach({
       system,                 // name of the parts system in the simulation (its api gives kinds, placements, graph...)
       shapes: { [kind]: {     // how each kind looks and handles
         geo(T, variant) -> BufferGeometry   // metres, in the kind's local frame; a stretch kind is 1 m long along +x (it is scaled)
         variantOf?(part) -> string          // e.g. "open" | "shut": one instanced mesh per variant
         rest?: [rx, ry, rz], lift?: m       // how it lies when loose, and how high its centre sits
         pick: m,                            // generous pick radius; small parts get big ones so they win in a pile
         name(part) -> string } },
       material?,              // THREE material (vertex colours) for every part
       canPlace?(way, ends) -> bool          // content veto on a placement (ends: world points), e.g. below ground
       surfaceAt?(x, z) -> y                 // what loose parts rest on (default: the terrain)
       onTap?(part, R) -> bool, tapHint?(part) -> string | null     // a click on a fitted part (a switch, a gate)
       onChange?(why, id)                    // after any command this view issued
     })
     view.held() -> id | null, view.give(id, from?) (into the hands), view.spill(ids, from, spots) (tumble out of a box),
     view.endWorld(p) -> { x, y, z }, view.refresh(), view.stats()
     __parts.mergeGeo(T, [[geometry, matrix | null, colourHex], ...]) -> one BufferGeometry with vertex colours
   Controls (through __reach): click a loose part to pick it up; bring it to a glowing end and click to fit, R to turn;
     click the ground to set it down, right-click to toss it; hold and drag a fitted part to pull it off; drag the free
     end of a fitted length to cut it shorter.
   Cost: instance matrices are rewritten only when the parts change. Per-frame work happens only while something is
     held, dragged or tumbling. */
(() => {
  const G = window.__game, RCH = window.__reach;
  if (!G || !RCH || !G.THREE) return;
  const T = G.THREE, CAP = 128;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), lerp = (a, b, k) => a + (b - a) * k;

  function mergeGeo(T, list) {
    const pos = [], nor = [], colr = [], idx = [], c = new T.Color(), v = new T.Vector3(), nm = new T.Matrix3();
    for (const [g0, m, hex] of list) {
      const g = g0.index ? g0.toNonIndexed() : g0, p = g.attributes.position, n = g.attributes.normal, base = pos.length / 3;
      c.setHex(hex); if (m) nm.getNormalMatrix(m);
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i); if (m) v.applyMatrix4(m); pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(n, i); if (m) v.applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
        colr.push(c.r, c.g, c.b); idx.push(base + i);
      }
      g0.dispose(); if (g !== g0) g.dispose();
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new T.Float32BufferAttribute(colr, 3));
    out.setIndex(idx);
    return out;
  }

  function attach(opts) {
    // G.sim is replaced when a new world starts: never keep it, always ask for it
    const sysDef = G.sim.systems.find((s) => s.name === opts.system);
    if (!sysDef) return null;
    const A = sysDef.api, N = opts.system, STEP = A.stepM, shapes = opts.shapes;
    const S = () => G.sim.state.sys[N];
    const cmd = (name, p) => { const r = G.sim.commandNow(N + '.' + name, p); opts.onChange && opts.onChange(name, p.id); return r; };
    const mat = opts.material || new T.MeshLambertMaterial({ vertexColors: true });
    const ghostMat = new T.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.6, depthWrite: false, fog: false });
    const hiMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false, fog: false });
    const glowMat = new T.MeshBasicMaterial({ color: 0xffb53d, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, fog: false });
    const root = new T.Group(); G.scene.add(root);
    const geos = new Map(), meshes = new Map();
    const variantOf = (part) => (shapes[part.kind].variantOf ? shapes[part.kind].variantOf(part) : '');
    const geoFor = (kind, variant) => { const k = kind + '|' + variant; if (!geos.has(k)) geos.set(k, shapes[kind].geo(T, variant)); return geos.get(k); };
    const meshFor = (kind, variant) => {
      const k = kind + '|' + variant;
      if (!meshes.has(k)) { const m = new T.InstancedMesh(geoFor(kind, variant), mat, CAP); m.count = 0; m.frustumCulled = false; m.castShadow = m.receiveShadow = true; root.add(m); meshes.set(k, m); }
      return meshes.get(k);
    };
    const single = (material) => { const m = new T.Mesh(new T.BufferGeometry(), material); m.matrixAutoUpdate = false; m.visible = false; m.frustumCulled = false; G.scene.add(m); return m; };
    const ghost = single(ghostMat), hi = single(hiMat), hand = single(mat);
    const band = new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 0.05, 20), new T.MeshBasicMaterial({ color: 0xffe27a, depthTest: false, transparent: true, opacity: 0.95 }));
    band.rotation.z = Math.PI / 2; band.matrixAutoUpdate = false; band.visible = false; band.renderOrder = 22; band.frustumCulled = false; G.scene.add(band);
    ghost.renderOrder = 20; hi.renderOrder = 21; hand.castShadow = true;
    const glows = new T.InstancedMesh(new T.SphereGeometry(0.055, 10, 8), glowMat, 48); glows.count = 0; glows.frustumCulled = false; glows.renderOrder = 22; G.scene.add(glows);

    // ---------------------------------------------------------------- where things are
    const _m = new T.Matrix4(), _o = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _v = new T.Vector3(), _s = new T.Vector3(), _x = new T.Vector3(), _y = new T.Vector3(), _z = new T.Vector3();
    const originM = () => { const o = S().origin; return _o.makeRotationY(o.yaw || 0).setPosition(o.x, o.y, o.z); };
    const isStretch = (kind) => !!A.kinds[kind].stretch;
    const lenM = (part, len) => (isStretch(part.kind) ? (len ?? A.lengthOf(part)) * STEP : 1);
    function fittedMatrix(out, kind, at, rot, len) {
      const r = A.ROTATIONS[rot];
      out.makeBasis(_x.fromArray(r[0]), _y.fromArray(r[1]), _z.fromArray(r[2]));
      if (isStretch(kind)) out.scale(_s.set(len * STEP, 1, 1));
      out.setPosition(at[0] * STEP, at[1] * STEP, at[2] * STEP);
      return out.premultiply(originM());
    }
    const surfaceAt = (x, z) => (opts.surfaceAt ? opts.surfaceAt(x, z) : G.heightAt(x, z));
    function looseMatrix(out, part, pose, len) {
      const sh = shapes[part.kind], rr = sh.rest || [0, 0, 0];
      _q.setFromEuler(_e.set(rr[0], (pose.yaw || 0) + rr[1], rr[2], 'YXZ'));
      const L = lenM(part, len);
      out.compose(_v.set(pose.x, pose.y + (sh.lift || 0.03), pose.z), _q, _s.set(isStretch(part.kind) ? L : 1, 1, 1));
      if (isStretch(part.kind)) { _v.set(-L / 2, 0, 0).applyQuaternion(_q); out.elements[12] += _v.x; out.elements[13] += _v.y; out.elements[14] += _v.z; }   // a length lies centred on its pose
      return out;
    }
    const partMatrix = (out, part, len) => (part.at ? fittedMatrix(out, part.kind, part.at, part.rot, len ?? A.lengthOf(part)) : looseMatrix(out, part, part.pose, len));
    const endWorld = (p) => A.toWorld(S(), p);
    // sample points along a part, in world metres (a fitting is one point)
    function samples(part) {
      partMatrix(_m, part);
      if (!isStretch(part.kind)) return [new T.Vector3().setFromMatrixPosition(_m)];
      const n = Math.max(2, Math.round(A.lengthOf(part) * 2) + 1), out = [];
      for (let i = 0; i < n; i++) out.push(new T.Vector3(i / (n - 1), 0, 0).applyMatrix4(_m));
      return out;
    }

    // ---------------------------------------------------------------- drawing
    let drawnV = -1, held = null, turn = 0, trim = 0, turnT = 0, turnQ = new T.Quaternion(), ghostQ = new T.Quaternion(), ghostOn = false, wig = null, lenDrag = null, flashT = 0, hoverId = null, ghostWay = null;
    const hidden = new Set(), flyers = [];
    function redraw() {
      const s = S();
      drawnV = s.version;
      for (const m of meshes.values()) m.count = 0;
      for (const id in s.parts) {
        const part = s.parts[id];
        if (hidden.has(id) || id === held) continue;
        const m = meshFor(part.kind, variantOf(part));
        if (m.count >= CAP) continue;
        partMatrix(_m, part, lenDrag && lenDrag.id === id ? lenDrag.len : undefined);
        if (wig && wig.id === id) { _m.elements[12] += wig.x; _m.elements[13] += wig.y; _m.elements[14] += wig.z; }
        m.setMatrixAt(m.count++, _m);
      }
      for (const m of meshes.values()) m.instanceMatrix.needsUpdate = true;
      drawGlows();
    }
    function drawGlows() {
      let n = 0;
      const part = held && S().parts[held], show = part || performance.now() < flashT;
      if (show) {
        const mates = A.mates, mine = part ? A.kinds[part.kind].ends.map((e) => e.type) : null;
        for (const e of A.graph(S()).open) {
          if (n >= 48) break;
          if (mine && !mine.some((t) => (mates[t] || []).includes(e.type))) continue;
          const w = endWorld(e.p);
          glows.setMatrixAt(n++, _m.makeTranslation(w.x + e.d[0] * 0.02, w.y + e.d[1] * 0.02, w.z + e.d[2] * 0.02));
        }
      }
      glows.count = n; glows.instanceMatrix.needsUpdate = true;
    }
    function showSingle(mesh, part, matrix, scale) {
      const g = geoFor(part.kind, variantOf(part));
      if (mesh.geometry !== g) mesh.geometry = g;
      mesh.matrix.copy(matrix);
      if (scale) mesh.matrix.scale(_s.set(scale, scale, scale));
      mesh.visible = true;
    }

    // ---------------------------------------------------------------- things in flight (scripted, never physics)
    function fly(id, from, to, { dur = 0.3, arc = 0, spin = 0, punch = 0, bounce = 0, done } = {}) {
      const part = S().parts[id]; if (!part) return;
      const mesh = new T.Mesh(geoFor(part.kind, variantOf(part)), mat); mesh.matrixAutoUpdate = false; mesh.castShadow = true; G.scene.add(mesh);
      const f = { id, mesh, t: 0, dur, arc, spin, punch, bounce, done, p0: new T.Vector3(), q0: new T.Quaternion(), s0: new T.Vector3(), p1: new T.Vector3(), q1: new T.Quaternion(), s1: new T.Vector3(),
        axis: new T.Vector3(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).normalize() };
      from.decompose(f.p0, f.q0, f.s0); to.decompose(f.p1, f.q1, f.s1);
      mesh.matrix.copy(from); hidden.add(id); flyers.push(f); drawnV = -1;
    }
    function stepFlyers(dt) {
      for (let i = flyers.length - 1; i >= 0; i--) {
        const f = flyers[i]; f.t += dt;
        const k = clamp(f.t / f.dur, 0, 1), e = k * k * (3 - 2 * k);
        _v.lerpVectors(f.p0, f.p1, f.arc ? k : e);
        _v.y += f.arc * 4 * k * (1 - k) + (f.bounce && k > 0.78 ? f.bounce * Math.sin(((k - 0.78) / 0.22) * Math.PI) : 0);
        _q.slerpQuaternions(f.q0, f.q1, e);
        if (f.spin) _q.multiply(new T.Quaternion().setFromAxisAngle(f.axis, f.spin * Math.PI * 2 * (1 - e)));
        _s.lerpVectors(f.s0, f.s1, e); if (f.punch) _s.multiplyScalar(1 + f.punch * Math.sin(Math.PI * clamp((k - 0.6) / 0.4, 0, 1)));
        f.mesh.matrix.compose(_v, _q, _s);
        if (k >= 1) { G.scene.remove(f.mesh); hidden.delete(f.id); flyers.splice(i, 1); drawnV = -1; f.done && f.done(); }
      }
    }
    // the matrix of a part carried in the hands (lengths across the body, centred)
    function handMatrix(out, part, R) {
      const h = R.beating ? R.overhead() : R.hand(), L = lenM(part);
      _q.setFromEuler(_e.set(0, h.yaw + Math.PI / 2, 0));
      out.compose(_v.set(h.x, h.y, h.z), _q, _s.set(isStretch(part.kind) ? L : 1, 1, 1));
      if (isStretch(part.kind)) { _v.set(-L / 2, 0, 0).applyQuaternion(_q); out.elements[12] += _v.x; out.elements[14] += _v.z; }
      return out;
    }
    const restPose = (x, z, yaw) => ({ x, y: surfaceAt(x, z), z, yaw });
    const nameOf = (part) => shapes[part.kind].name(part);
    const puff = (w, n = 6) => G.burst(w.x, w.y, w.z, n, 0xeae4d2, 1.1, 1.0, 0.05, 0.32);

    // ---------------------------------------------------------------- handling
    function give(id, fromMatrix) {
      const part = S().parts[id]; if (!part) return;
      held = id; turn = 0; trim = 0; turnT = 0; RCH.R.hold({ by: N, id });
      handFrom.copy(fromMatrix || partMatrix(_m, part)); handK = 0;
      drawnV = -1;
    }
    const handFrom = new T.Matrix4(); let handK = 1;
    function letGo() { held = null; trim = 0; band.visible = false; turnT = 0; RCH.R.drop(); hand.visible = ghost.visible = false; ghostWay = null; drawnV = -1; }
    function tossTo(R, x, z, far) {
      const part = S().parts[held], id = held; if (!part) return;
      const from = handMatrix(new T.Matrix4(), part, R), pose = restPose(x, z, Math.random() * 6.28);
      cmd('move', { id, pose });
      const to = looseMatrix(new T.Matrix4(), part, pose);
      letGo();
      fly(id, from, to, { dur: far ? 0.55 : 0.3, arc: far ? 0.45 : 0.12, spin: far ? 1.5 : 0.25, bounce: far ? 0.1 : 0.04, done: () => { G.burst(pose.x, pose.y + 0.05, pose.z, far ? 5 : 3, 0xb9a783, 1, 0.8, 0.05, 0.3); } });
    }
    // cutting a held or loose length: C, [ ], wheel. Stock is conserved by the sim's cut; the offcut lies at the player's feet
    const minLen = (part) => A.kinds[part.kind].stretch.min;
    function cutHeld(R, len, say) {
      const part = S().parts[held]; if (!part || !isStretch(part.kind) || !(len < A.lengthOf(part)) || len < minLen(part)) return false;
      const f = R.player.face, id = held, w = new T.Vector3().setFromMatrixPosition(handMatrix(_m, part, R));
      const c = cmd('cut', { id, len, pose: restPose(R.player.x + Math.sin(f) * 1.1, R.player.z + Math.cos(f) * 1.1, f + Math.PI / 2) });
      if (!c.ok) { R.say('It will not cut: ' + c.reason + '.'); return false; }
      trim = 0; band.visible = false; drawnV = -1;
      G.burst(w.x, w.y, w.z, 8, 0xdfe6ea, 1.4, 1.2, 0.04, 0.35); G.cam.shake = Math.min(G.cam.shake + 0.04, 0.5); G.juice.hitStop = 0.02;
      R.say(say || 'Cut to ' + (len * STEP).toFixed(2) + ' m. The offcut lies at your feet.', 2.2);
      return true;
    }
    function trimBy(d) {
      const part = held && S().parts[held]; if (!part || !isStretch(part.kind)) return false;
      const full = A.lengthOf(part), min = minLen(part);
      trim = clamp((trim || full) + d, min, full); if (trim >= full) trim = 0; return true;
    }
    function fit(R, hit) {
      const part = S().parts[held], id = held, way = hit.way;
      let offcut = null;
      if (way.len && way.len < A.lengthOf(part)) { const c = cmd('cut', { id, len: way.len, pose: restPose(R.player.x, R.player.z, 0) }); if (c.ok) offcut = c.offcut; }
      const from = handMatrix(new T.Matrix4(), part, R);
      const r = cmd('fit', { id, at: way.at, rot: way.rot });
      if (!r.ok) { R.say('It will not go there: ' + r.reason + '.'); return; }
      const to = fittedMatrix(new T.Matrix4(), part.kind, way.at, way.rot, A.lengthOf(part)), w = endWorld(hit.end.p);
      letGo();
      R.pose(-1.55, -1.55, 0.28, 0.2);
      fly(id, from, to, { dur: 0.16, punch: 0.22, done: () => { puff(w, 7); G.cam.shake = Math.min(G.cam.shake + 0.06, 0.5); G.juice.hitStop = 0.03; flashT = performance.now() + 900; drawnV = -1; } });
      if (offcut) { give(offcut, to); R.say('Cut to fit. The offcut is in your hands.', 2.5); }
    }
    // the open end the pointer is nearest, and the ways the held part can go on it
    const holdKeys = (part) => (isStretch(part.kind) ? '.  <b>C</b> cuts it, then <b>[ ]</b> or wheel set the length' : '');
    function offer(R) {
      const part = S().parts[held]; if (!part) return null;
      const mine = A.kinds[part.kind].ends.map((e) => e.type);
      let best = null;
      for (const e of A.graph(S()).open) {
        if (!mine.some((t) => (A.mates[t] || []).includes(e.type))) continue;
        const w = endWorld(e.p);
        if (!R.within(w.x, w.z, 0.5)) continue;
        const d = R.rayDist(w.x, w.y, w.z).d;
        if (d < 0.6 && (!best || d < best.d)) best = { d, e, w };
      }
      if (!best) return null;
      let ways = A.placements(S(), part.kind, A.lengthOf(part), best.e, held);
      if (opts.canPlace) ways = ways.filter((w) => opts.canPlace(w, A.partEnds({ kind: part.kind, len: w.len, at: w.at, rot: w.rot }).map((x) => endWorld(x.p))));
      return ways.length ? { ...best, ways } : null;
    }
    const user = {
      id: N,
      near(px, pz) { const s = S(); for (const id in s.parts) { const p = s.parts[id]; if (p.fixed) continue; const w = p.at ? endWorld(p.at) : p.pose; if (Math.hypot(w.x - px, w.z - pz) < 3.5) return true; } return false; },
      hover(R) {
        const s = S();
        hoverId = null;
        if (held) {
          const part = s.parts[held]; if (!part) { letGo(); return null; }
          const o = offer(R);
          if (o) {
            const way = o.ways[turn % o.ways.length]; ghostWay = way;
            showSingle(ghost, part, fittedMatrix(_m, part.kind, way.at, way.rot, way.len ?? 1));
            const tooLong = way.len && way.len < A.lengthOf(part), cutNote = tooLong ? ', cut to ' + (way.len * STEP).toFixed(2) + ' m' : '';
            return { score: o.d * 0.4, kind: 'fit', way, end: o.e, x: o.w.x, y: o.w.y, z: o.w.z,
              hint: '<b>Click</b> to fit the ' + nameOf(part) + cutNote + (tooLong ? '   <b>C</b> cuts it to fit' : '') + (o.ways.length > 1 ? '   <b>R</b> turns it (' + ((turn % o.ways.length) + 1) + ' of ' + o.ways.length + ')' : '') };
          }
          ghost.visible = false; ghostWay = null;
          if (trim) return { score: 9, kind: 'trim', x: R.player.x, z: R.player.z, hint: 'Cutting to <b>' + (trim * STEP).toFixed(2) + ' m</b>.  <b>[ ]</b> or wheel change it, <b>C</b> or click cuts' };
          if (R.ground && R.within(R.ground.x, R.ground.z, 0.4)) return { score: 9, kind: 'put', x: R.ground.x, z: R.ground.z, hint: 'Holding the ' + nameOf(part) + '.  Bring it to a glowing end to fit it.  <b>Click</b> sets it down, <b>right-click</b> tosses it' + holdKeys(part) };
          return null;
        }
        let best = null;
        for (const id in s.parts) {
          const part = s.parts[id];
          if (part.fixed || hidden.has(id)) continue;
          const pts = samples(part), rad = shapes[part.kind].pick;
          let dmin = 1e9, imin = 0;
          for (let i = 0; i < pts.length; i++) { const d = R.rayDist(pts[i].x, pts[i].y, pts[i].z).d; if (d < dmin) { dmin = d; imin = i; } }
          if (dmin > rad || !R.within(pts[imin].x, pts[imin].z, 0.3)) continue;
          const score = dmin / rad + (isStretch(part.kind) ? 0.3 : 0);                 // small parts beat long ones when both are close
          if (!best || score < best.score) best = { score, id, part, at: pts[imin], i: imin, n: pts.length };
        }
        if (!best) { hi.visible = false; return null; }
        const part = best.part; hoverId = best.id;
        showSingle(hi, part, partMatrix(_m, part), 1);
        const h = { score: best.score, kind: 'part', id: best.id, x: best.at.x, y: best.at.y, z: best.at.z };
        if (!part.at) { h.hint = '<b>Click</b> to pick up the ' + nameOf(part); return h; }
        // a fitted length whose far end is free can be cut by dragging that end
        if (isStretch(part.kind)) {
          const ends = A.partEnds(part), open = A.graph(s).open.filter((e) => e.part === best.id);
          const freeB = open.find((e) => e.end === A.kinds[part.kind].stretch.end), freeA = open.find((e) => e.end !== A.kinds[part.kind].stretch.end);
          if (freeB && !freeA && A.lengthOf(part) > A.kinds[part.kind].stretch.min && best.i >= best.n - 2) { h.endDrag = true; h.base = endWorld(ends.find((e) => e.id !== freeB.end).p); h.tip = endWorld(freeB.p); h.hint = '<b>Drag the end</b> back to cut it shorter'; h.hintDown = 'Drag toward the joint.  Let go to cut'; return h; }
        }
        const tap = opts.tapHint && opts.tapHint(part);
        h.hint = (tap ? tap + '   ' : '') + '<b>Hold and drag</b> to pull the ' + nameOf(part) + ' off';
        h.hintDown = 'Keep pulling…';
        return h;
      },
      press(hit, R) {
        hi.visible = false;
        if (hit.kind === 'fit') return fit(R, hit);
        if (hit.kind === 'trim') return cutHeld(R, trim);
        if (hit.kind === 'put') return tossTo(R, hit.x, hit.z, false);
        const part = S().parts[hit.id]; if (!part) return;
        if (!part.at) { give(hit.id); R.pose(-0.9, -0.9, 0.35, 0.15); return; }
        if (hit.endDrag) { lenDrag = { id: hit.id, len: A.lengthOf(part), full: A.lengthOf(part) }; return; }
        wig = { id: hit.id, k: 0, x: 0, y: 0, z: 0 };
      },
      move(hit, R) {
        if (lenDrag) {
          // closest point on the part's axis to the pointer ray
          const b = hit.base, t = hit.tip, ax = t.x - b.x, ay = t.y - b.y, az = t.z - b.z, L = Math.hypot(ax, ay, az), ux = ax / L, uy = ay / L, uz = az / L;
          const o = R.ray.origin, d = R.ray.direction, wx = b.x - o.x, wy = b.y - o.y, wz = b.z - o.z;
          const bb = ux * d.x + uy * d.y + uz * d.z, dd = ux * wx + uy * wy + uz * wz, ee = d.x * wx + d.y * wy + d.z * wz, den = 1 - bb * bb;
          const along = den < 1e-4 ? L : (bb * ee - dd) / den;
          const len = clamp(Math.round(along / STEP), A.kinds[S().parts[lenDrag.id].kind].stretch.min, lenDrag.full);
          if (len !== lenDrag.len) { lenDrag.len = len; drawnV = -1; }
          hit.hintDown = len < lenDrag.full ? 'Let go to cut it to <b>' + (len * STEP).toFixed(2) + ' m</b> (' + ((lenDrag.full - len) * STEP).toFixed(2) + ' m comes off)' : 'Drag toward the joint.  Let go to cut';
          return;
        }
        if (!wig) return;
        const k = Math.hypot(R.ptr.dx, R.ptr.dy) / 55;
        wig.k = k; const j = 0.012 * Math.min(1, k);
        wig.x = (Math.random() - 0.5) * j * 2; wig.y = Math.min(1, k) * 0.03 + (Math.random() - 0.5) * j; wig.z = (Math.random() - 0.5) * j * 2; drawnV = -1;
        if (k >= 1) {
          const id = wig.id, part = S().parts[id], from = partMatrix(new T.Matrix4(), part), w = new T.Vector3().setFromMatrixPosition(from);
          wig = null;
          const r = cmd('unfit', { id, pose: restPose(R.player.x, R.player.z, 0) });
          if (!r.ok) { R.say('That is fixed in place.'); return; }
          puff(w, 8); G.cam.shake = Math.min(G.cam.shake + 0.08, 0.5); G.juice.hitStop = 0.03; R.pose(-0.6, -0.6, -0.2, 0.22);
          give(id, from);
        }
      },
      release(hit, R, cancelled) {
        if (lenDrag) {
          const d = lenDrag; lenDrag = null; drawnV = -1;
          if (!cancelled && d.len < d.full) {
            const part = S().parts[d.id], tipM = fittedMatrix(new T.Matrix4(), part.kind, part.at, part.rot, d.full), cut = new T.Vector3(d.len / d.full, 0, 0).applyMatrix4(tipM);
            const r = cmd('cut', { id: d.id, len: d.len, pose: restPose(cut.x, cut.z, 0) });
            if (r.ok) {
              G.burst(cut.x, cut.y, cut.z, 8, 0xdfe6ea, 1.4, 1.2, 0.04, 0.35); G.cam.shake = Math.min(G.cam.shake + 0.05, 0.5); G.juice.hitStop = 0.025;
              const om = new T.Matrix4().copy(tipM); om.setPosition(cut.x, cut.y, cut.z);
              if (!held) { give(r.offcut, om); R.say('Cut. The offcut is in your hands.', 2.5); }
            }
          }
          return;
        }
        if (wig) {
          const tapped = wig.k < 0.12, part = S().parts[wig.id];
          wig = null; drawnV = -1;
          if (tapped && !cancelled && part && opts.onTap) opts.onTap(part, R);
        }
      },
      secondary(R) {
        if (!held) return false;
        const f = R.player.face;
        tossTo(R, R.player.x + Math.sin(f) * 1.5 + (Math.random() - 0.5) * 0.3, R.player.z + Math.cos(f) * 1.5 + (Math.random() - 0.5) * 0.3, true);
        return true;
      },
      key(code, R) {
        if (!held) return false;
        if (code === 'KeyR') { if (ghost.visible) { turnQ.copy(ghostQ); turnT = 0.15; } turn++; return true; }
        const part = S().parts[held];
        if (!part || !isStretch(part.kind)) return false;
        if (code === 'KeyC') {
          if (trim) return cutHeld(R, trim) || true;
          if (ghost.visible && ghostWay && ghostWay.len && ghostWay.len < A.lengthOf(part)) return cutHeld(R, ghostWay.len, 'Cut to fit. The offcut lies at your feet.') || true;
          if (A.lengthOf(part) <= minLen(part)) { R.say('That is already as short as it cuts.', 1.8); return true; }
          trim = A.lengthOf(part) - 1; return true;                                   // first press starts trimming one step in
        }
        if (code === 'BracketLeft' || code === 'Minus') return trimBy(-1);
        if (code === 'BracketRight' || code === 'Equal') return trimBy(1);
        return false;
      },
      wheel(dy) { return !!held && trim > 0 && trimBy(dy > 0 ? -1 : 1); },
      hint() { const p = held && S().parts[held]; return p ? (trim ? 'Cutting to <b>' + (trim * STEP).toFixed(2) + ' m</b>.  <b>[ ]</b> or wheel change it, <b>C</b> or click cuts' : 'Holding the ' + nameOf(p) + '.  Bring it to a glowing end to fit it' + holdKeys(p)) : null; },
      leave(R) { hi.visible = ghost.visible = false; if (held) tossTo(R, R.player.x + 0.4, R.player.z + 0.4, false); wig = lenDrag = null; drawnV = -1; },
      frame(dt, R) {
        watchSim();
        if (flyers.length) stepFlyers(dt);
        if (held) {
          const part = S().parts[held];
          if (!part) letGo();
          else {
            handMatrix(_m, part, R);
            if (handK < 1) {                                       // it comes up from where it lay
              handK = Math.min(1, handK + dt * 7);
              const a = new T.Vector3(), b = new T.Vector3(), qa = new T.Quaternion(), qb = new T.Quaternion(), sa = new T.Vector3(), sb = new T.Vector3();
              handFrom.decompose(a, qa, sa); _m.decompose(b, qb, sb);
              const k = handK * handK * (3 - 2 * handK);
              a.lerp(b, k); a.y += 0.25 * 4 * k * (1 - k); qa.slerp(qb, k); sa.lerp(sb, k); _m.compose(a, qa, sa);
            }
            showSingle(hand, part, _m);
            glowMat.opacity = 0.55 + 0.4 * Math.sin(performance.now() * 0.008);
          }
        } else if (hand.visible) hand.visible = false;
        if (held && trim && S().parts[held]) {                      // the cutting mark sits where the blade will go
          const part = S().parts[held], full = A.lengthOf(part);
          handMatrix(_m, part, R); _v.set(trim / full, 0, 0).applyMatrix4(_m);
          const h = R.beating ? R.overhead() : R.hand(); _q.setFromEuler(_e.set(0, h.yaw + Math.PI / 2, 0));
          band.matrix.compose(_v, _q, _s.set(1, 1, 1)).multiply(_o.makeRotationZ(Math.PI / 2)); band.visible = true;
        } else if (band.visible) band.visible = false;
        if (ghost.visible) {                                         // a quick swing to a new orientation (visual only)
          ghost.matrix.decompose(_v, _q, _s); ghostQ.copy(_q);
          if (turnT > 0) { turnT = Math.max(0, turnT - dt); const k = 1 - turnT / 0.15; _q.slerpQuaternions(turnQ, ghostQ, 1 - (1 - k) * (1 - k)); ghost.matrix.compose(_v, _q, _s); }
        }
        if (!R.on && hi.visible) hi.visible = false;
        if (glows.count && !held && performance.now() > flashT) drawnV = -1;
        if (S().version !== drawnV) redraw();
      },
    };
    RCH.use(user);
    let simSeen = null;
    const reset = () => { for (const f of flyers) G.scene.remove(f.mesh); flyers.length = 0; hidden.clear(); wig = lenDrag = null; if (held) letGo(); hi.visible = ghost.visible = false; drawnV = -1; };
    const watchSim = () => { if (G.sim === simSeen) return; simSeen = G.sim; reset(); G.sim.listen((type) => { if (type === 'loaded') reset(); }); };
    return {
      held: () => held, give, endWorld, refresh: () => { drawnV = -1; }, fly, looseMatrix, fittedMatrix, restPose, api: A, state: S,
      // parts tumbling out of something: from a world point to the given resting spots
      spill(ids, from, spots) {
        ids.forEach((id, i) => {
          const part = S().parts[id]; if (!part) return;
          const sp = spots[i % spots.length], pose = restPose(sp.x, sp.z, sp.yaw ?? Math.random() * 6.28);
          G.sim.commandNow(N + '.move', { id, pose });
          const m0 = new T.Matrix4().compose(new T.Vector3(from.x, from.y, from.z), new T.Quaternion(), new T.Vector3(isStretch(part.kind) ? lenM(part) * 0.3 : 0.3, 0.3, 0.3));
          hidden.add(id);
          setTimeout(() => fly(id, m0, looseMatrix(new T.Matrix4(), part, pose), { dur: 0.45 + Math.random() * 0.2, arc: 0.5, spin: 1.2, bounce: 0.08, done: () => G.burst(pose.x, pose.y + 0.04, pose.z, 3, 0xb9a783, 0.9, 0.7, 0.045, 0.3) }), 60 * i);
        });
        drawnV = -1;
      },
      stats: () => ({ held, flyers: flyers.length, ghost: ghost.visible, ghostWay, hover: hoverId, glows: glows.count, turn }),
    };
  }
  window.__parts = { attach, mergeGeo };
})();
