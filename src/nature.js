/* The living world: ground cover on the forest floor and meadows, insects, and woodland animals. */
(() => {
  const G = window.__game,
    BL = window.__build;
  if (!G || !BL) return;
  const T = G.THREE,
    W = G.world,
    P = G.player,
    { Geo, shade, hash, col } = BL,
    TAU = Math.PI * 2,
    clamp = (v, a, b) => Math.max(a, Math.min(b, v)),
    lerp = (a, b, t) => a + (b - a) * t;
  const rng = (seed) => {
    let s = seed >>> 0 || 1;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const strHash = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  const sun = () => Math.sin((W.time - 0.25) * TAU);

  /* ================= one light for everything ================= */
  // Every surface in the world is shaded by the same rule: light wraps a little past the edge,
  // and shade is never fully dark. Without this the rocks, buildings, animals and player are lit
  // more harshly than the trees and grass around them and look pasted in.
  const ORIG = { begin: T.ShaderChunk.lights_fragment_begin, pars: T.ShaderChunk.lights_lambert_pars_fragment };
  const RE_SHADOW = /(directLight\.color \*= \( directLight\.visible && receiveShadow \) \? )(getShadow\( directionalShadowMap[^;]*?\))( : 1\.0;)/,
    RE_NL = /float dotNL = saturate\( dot\( geometryNormal, directLight\.direction \) \);/;
  T.ShaderChunk.lights_fragment_begin = ORIG.begin.replace(RE_SHADOW, "$1 mix( 0.14, 1.0, $2 ) $3");
  T.ShaderChunk.lights_lambert_pars_fragment = ORIG.pars.replace(RE_NL, "float dotNL = saturate( dot( geometryNormal, directLight.direction ) * 0.68 + 0.32 );");
  T.Material.prototype.customProgramCacheKey = function () {
    return this.onBeforeCompile.toString() + "|even";
  };
  G.scene.traverse((o) => {
    for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) m.needsUpdate = true;
  });

  /* ================= ground cover ================= */
  const C = {
    bark: col(0x5c5248),
    grey: col(0x8a8378),
    pale: col(0xb9ad98),
    needle: col(0x7a5a36),
    leafDead: col(0xa9722f),
    leafGold: col(0xc79a3a),
    cone: col(0x5a4838),
    fern: col(0x3f7a35),
    fern2: col(0x55913f),
    moss: col(0x55742f),
    stone: col(0x86837c),
    stone2: col(0x6c6a66),
    straw: col(0xc9b874),
    seed: col(0xe2d6a0),
    reed: col(0x6f8f3c),
    cattail: col(0x4b3220),
    soil: col(0x4a3524),
    shroomRed: col(0xb5382c),
    shroomTan: col(0xb98d5c),
    white: col(0xece6d8),
    berry: col(0xa12a3a),
    leaf: col(0x3f7033),
    ivy: col(0x3a7036),
    ivy2: col(0x5c9444),
    heather: col(0x9a5a9a),
    heather2: col(0xb878a8),
    lichen: col(0xa9b06a),
    cane: col(0x554442),
    pine: col(0x2f5f33),
    pine2: col(0x4f8540),
    holly: col(0x24502c),
    hazel: col(0x5d8a3c),
    rockWarm: col(0x8f8672),
    rockCool: col(0x74787c),
  };
  const N_VAR = 3;
  const templates = new Map();
  // each kind of ground cover is modelled a few times over, then stamped about with a turn and a scale
  function template(kind, v) {
    const key = kind + v;
    if (templates.has(key)) return templates.get(key);
    const g = new Geo(),
      r = rng(strHash(key) + 11),
      up = [0, 1, 0];
    const leafy = (cx, cy, cz, rad, n, c) => {
      for (let k = 0; k < n; k++) {
        const a = r() * TAU,
          el = r() * 1.3 - 0.1,
          ox = Math.cos(a) * Math.cos(el),
          oy = Math.sin(el),
          oz = Math.sin(a) * Math.cos(el),
          x = cx + ox * rad,
          y = cy + oy * rad * 0.8,
          z = cz + oz * rad,
          w = 0.05 + r() * 0.04,
          cc = shade(c, 0.85 + 0.5 * r()),
          nn = [ox * 0.5, 0.8, oz * 0.5];
        g.triS([x - oz * w, y, z + ox * w], [x + oz * w, y + 0.02, z - ox * w], [x + ox * w * 2.4, y + oy * w * 2 - 0.02, z + oz * w * 2.4], nn, nn, nn, cc, cc, shade(cc, 1.2));
      }
    };
    const blade = (x, z, lean, h, w, c0, c1) => {
      const tx = x + Math.cos(lean) * h * 0.3,
        tz = z + Math.sin(lean) * h * 0.3,
        px = -Math.sin(lean) * w,
        pz = Math.cos(lean) * w;
      g.triS([x - px, 0, z - pz], [x + px, 0, z + pz], [tx, h, tz], up, up, up, c0, c0, c1);
    };
    switch (kind) {
      case "fleck": {
        // fallen needles and dead leaves
        for (let k = 0; k < 7; k++) {
          const x = (r() - 0.5) * 0.9,
            z = (r() - 0.5) * 0.9,
            a = r() * TAU,
            l = 0.07 + r() * 0.1,
            w = 0.02 + r() * 0.035,
            c = shade([C.needle, C.leafDead, C.leafGold, C.bark][Math.floor(r() * 3.6)], 0.75 + 0.4 * r()),
            y = 0.018 + r() * 0.012,
            ax = Math.cos(a) * l,
            az = Math.sin(a) * l,
            bx = -Math.sin(a) * w,
            bz = Math.cos(a) * w;
          g.tri([x - ax, y, z - az], [x + bx, y, z + bz], [x + ax, y, z + az], up, c);
          g.tri([x - ax, y, z - az], [x + ax, y, z + az], [x - bx, y, z - bz], up, c);
        }
        break;
      }
      case "twig": {
        const l = 0.35 + r() * 0.55,
          c = shade(v ? C.bark : C.grey, 0.8 + 0.3 * r());
        g.cyl([-l / 2, 0.03, 0], [l / 2, 0.045 + r() * 0.05, (r() - 0.5) * 0.12], 0.02, 0.011, 3, c, c);
        g.cyl([l * 0.05, 0.035, 0], [l * 0.32, 0.05, 0.14 + r() * 0.12], 0.012, 0.006, 3, c, c, false);
        if (v === 2) g.cyl([-l * 0.2, 0.035, 0], [-l * 0.02, 0.07, -0.16], 0.011, 0.005, 3, c, c, false);
        break;
      }
      case "drift": {
        const l = 0.6 + r() * 0.7;
        g.cyl([-l / 2, 0.05, 0], [l / 2, 0.07, 0.1], 0.05, 0.03, 5, shade(C.pale, 0.85), C.pale);
        g.cyl([0, 0.06, 0.02], [l * 0.25, 0.14, 0.22], 0.022, 0.01, 3, C.pale, C.pale, false);
        break;
      }
      case "cone":
        g.cyl([-0.05, 0.035, 0], [0.06, 0.03, 0.01], 0.04, 0.012, 5, shade(C.cone, 0.8), shade(C.cone, 1.2 + 0.2 * v));
        break;
      case "fern": {
        const n = 5 + v;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU + r(),
            len = 0.4 + r() * 0.3,
            rise = 0.22 + r() * 0.16,
            cx = Math.cos(a),
            cz = Math.sin(a),
            c = k % 2 ? C.fern : C.fern2;
          g.surf(
            1,
            3,
            (u, t) => {
              const w = 0.11 * Math.sin(Math.PI * Math.min(1, t * 0.85 + 0.12)) * (u - 0.5) * 2,
                d = len * t;
              return [cx * d - cz * w, rise * Math.sin(t * 2.3) + 0.02, cz * d + cx * w];
            },
            (u, t) => shade(c, 0.7 + 0.45 * t),
          );
        }
        break;
      }
      case "shroom": {
        const n = 1 + v,
          cap = [C.shroomRed, C.shroomTan, C.white][v];
        for (let k = 0; k < n; k++) {
          const x = (r() - 0.5) * 0.22,
            z = (r() - 0.5) * 0.22,
            h = 0.07 + r() * 0.08,
            cr = 0.04 + r() * 0.035;
          g.cyl([x, 0, z], [x + 0.01, h, z], 0.014, 0.011, 5, shade(C.white, 0.8), C.white, false);
          g.cyl([x + 0.01, h - 0.012, z], [x + 0.012, h + cr * 0.55, z], cr, cr * 0.25, 6, shade(cap, 0.8), cap);
        }
        break;
      }
      case "stone":
      case "mossy": {
        const s = 0.09 + r() * 0.14;
        g.ball([0, s * 0.35, 0], s, s * (0.5 + 0.3 * r()), s * (0.7 + 0.4 * r()), kind === "mossy" ? C.moss : v ? C.stone : C.stone2, { flat: true, jit: 0.22, seed: v + 3, lat: 3, lon: 5 });
        if (v === 1) g.ball([s * 1.1, s * 0.2, s * 0.4], s * 0.45, s * 0.3, s * 0.4, C.stone2, { flat: true, jit: 0.2, seed: 9, lat: 2, lon: 5 });
        break;
      }
      case "seedgrass": {
        for (let k = 0; k < 6; k++) blade((r() - 0.5) * 0.4, (r() - 0.5) * 0.4, r() * TAU, 0.5 + r() * 0.4, 0.016, shade(C.straw, 0.75), k % 2 ? C.seed : C.straw);
        break;
      }
      case "shrub": {
        for (let k = 0; k < 4; k++) g.ball([(r() - 0.5) * 0.5, 0.22 + r() * 0.25, (r() - 0.5) * 0.5], 0.26 + r() * 0.1, 0.22, 0.26, shade(C.leaf, 0.85 + 0.3 * r()), { flat: true, jit: 0.22, seed: k + v * 5, lat: 3, lon: 6 });
        leafy(0, 0.3, 0, 0.45, 24, C.leaf);
        for (let k = 0; k < 6; k++) g.ball([(r() - 0.5) * 0.7, 0.3 + r() * 0.3, (r() - 0.5) * 0.7], 0.03, 0.03, 0.03, v === 1 ? col(0x3a4a9a) : C.berry, { lat: 2, lon: 4 });
        break;
      }
      case "reed": {
        for (let k = 0; k < 6; k++) {
          const x = (r() - 0.5) * 0.5,
            z = (r() - 0.5) * 0.5,
            h = 0.9 + r() * 0.7,
            lean = r() * TAU;
          blade(x, z, lean, h, 0.022, shade(C.reed, 0.7), C.reed);
          if (k % 2 === 0) {
            const tx = x + Math.cos(lean) * h * 0.3,
              tz = z + Math.sin(lean) * h * 0.3;
            g.cyl([tx, h - 0.2, tz], [tx, h - 0.04, tz], 0.028, 0.028, 4, C.cattail, C.cattail);
          }
        }
        break;
      }
      case "boulder": {
        // a knee-high rock with lichen and a cap of moss
        const s = 0.3 + r() * 0.16,
          tone = [C.stone, C.rockWarm, C.rockCool][v];
        g.ball([0, s * 0.42, 0], s, s * (0.55 + 0.25 * r()), s * (0.75 + 0.3 * r()), tone, { flat: true, jit: 0.24, seed: v * 7 + 2, lat: 3, lon: 6 });
        g.ball([s * 0.75, s * 0.2, s * 0.35], s * 0.5, s * 0.33, s * 0.45, shade(tone, 0.85), { flat: true, jit: 0.22, seed: v + 31, lat: 3, lon: 5 });
        for (let k = 0; k < 4; k++) {
          const a = r() * TAU;
          g.ball([Math.cos(a) * s * 0.6, s * (0.5 + 0.3 * r()), Math.sin(a) * s * 0.5], s * 0.2, s * 0.12, s * 0.2, k % 2 ? C.lichen : C.moss, { flat: true, jit: 0.3, seed: k + 5, lat: 2, lon: 5 });
        }
        break;
      }
      case "slab": {
        // tilted ledges of bedrock breaking the surface
        const tone = [C.rockCool, C.stone2, C.rockWarm][v],
          n = 2 + (v % 2);
        for (let k = 0; k < n; k++) {
          const l = 0.5 + r() * 0.45,
            z = (k - (n - 1) / 2) * 0.34,
            lift = 0.06 + r() * 0.16;
          g.beam([-l, 0.02, z], [l * 0.9, lift * 2, z + (r() - 0.5) * 0.2], 0.3 + r() * 0.14, 0.2 + r() * 0.1, shade(tone, 0.85 + 0.3 * r()), 0.3);
        }
        g.ball([0.2, 0.2, 0.1], 0.2, 0.07, 0.16, C.moss, { flat: true, jit: 0.3, seed: v + 4, lat: 2, lon: 5 });
        break;
      }
      case "gravel":
        for (let k = 0; k < 7; k++) {
          const s = 0.03 + r() * 0.05;
          g.ball([(r() - 0.5) * 0.9, s * 0.4, (r() - 0.5) * 0.9], s, s * 0.6, s * 0.85, shade([C.stone, C.rockWarm, C.stone2, C.pale][k % 4], 0.8 + 0.4 * r()), { flat: true, jit: 0.2, seed: k + v, lat: 2, lon: 4 });
        }
        break;
      case "bramble": {
        // a low, dense thicket: a leafy mound with sprays of leaves arching just out of it (no bare canes: those read as spider legs)
        const tone = v ? C.hazel : C.leaf;
        for (let k = 0; k < 4; k++) {
          const a = r() * TAU,
            d = r() * 0.3;
          g.ball([Math.cos(a) * d, 0.16 + r() * 0.16, Math.sin(a) * d], 0.3 + r() * 0.12, 0.17 + r() * 0.07, 0.3 + r() * 0.12, shade(tone, 0.72 + 0.3 * r()), { flat: true, jit: 0.26, seed: k + v * 7, lat: 3, lon: 6 });
        }
        leafy(0, 0.2, 0, 0.5, 30, tone);
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * TAU + r(),
            reach = 0.5 + r() * 0.2,
            top = 0.3 + r() * 0.12,
            cx = Math.cos(a),
            cz = Math.sin(a),
            pt = (t) => [cx * reach * t, 0.12 + top * Math.sin(Math.PI * Math.min(1, t * 0.8)), cz * reach * t];
          for (let q = 2; q <= 9; q++) {
            const p = pt(q / 9),
              la = a + (q % 2 ? 1.3 : -1.3),
              lx = Math.cos(la) * 0.15,
              lz = Math.sin(la) * 0.15,
              c = shade(tone, 0.85 + 0.4 * r());
            g.triS(p, [p[0] + lx + cx * 0.07, p[1] + 0.04, p[2] + lz + cz * 0.07], [p[0] + lx * 0.5 - cx * 0.07, p[1] + 0.02, p[2] + lz * 0.5 - cz * 0.07], [0, 1, 0], [0, 1, 0], [0, 1, 0], c, c, shade(c, 1.15));
            if (q % 3 === 0) g.ball([p[0], p[1] - 0.02, p[2]], 0.025, 0.025, 0.025, v ? col(0x3a2248) : C.berry, { lat: 2, lon: 4 });
          }
        }
        break;
      }
      case "heather": {
        // low wiry tufts, flowering at the tips
        for (let k = 0; k < 16; k++) {
          const d = Math.sqrt(r()) * 0.34,
            a = r() * TAU,
            tip = k % 3 === 0 ? C.heather2 : C.heather;
          blade(Math.cos(a) * d, Math.sin(a) * d, a, 0.2 + r() * 0.2 * (1 - d), 0.03, shade(C.leaf, 0.7), shade(tip, 0.85 + 0.3 * r()));
        }
        g.ball([0, 0.07, 0], 0.3, 0.09, 0.3, shade(C.leaf, 0.7), { flat: true, jit: 0.3, seed: v + 3, lat: 2, lon: 5 });
        break;
      }
      case "bush": {
        // holly, hazel or juniper: waist-high and dense
        const tone = [C.holly, C.hazel, C.pine][v];
        for (let k = 0; k < 5; k++) {
          const a = r() * TAU,
            d = r() * 0.4;
          g.ball([Math.cos(a) * d, 0.3 + r() * 0.5, Math.sin(a) * d], 0.32 + r() * 0.14, 0.28 + r() * 0.1, 0.32 + r() * 0.14, shade(tone, 0.78 + 0.4 * r()), { flat: true, jit: 0.24, seed: k + v * 11, lat: 3, lon: 5 });
        }
        leafy(0, 0.55, 0, 0.62, 36, tone);
        g.cyl([0, 0, 0], [0.04, 0.4, 0], 0.035, 0.02, 4, C.bark, C.bark, false);
        if (v === 0) for (let k = 0; k < 8; k++) g.ball([(r() - 0.5) * 0.8, 0.3 + r() * 0.6, (r() - 0.5) * 0.8], 0.028, 0.028, 0.028, C.berry, { lat: 2, lon: 4 });
        break;
      }
      case "sapling": {
        // a young pine
        const h = 0.7 + r() * 0.8;
        g.cyl([0, 0, 0], [0.02, h, 0], 0.03, 0.008, 4, C.bark, C.bark, false);
        for (let tier = 0; tier < 5; tier++) {
          const y = h * (0.18 + tier * 0.17),
            reach = h * 0.34 * (1 - tier * 0.17);
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * TAU + tier * 0.7,
              cx = Math.cos(a),
              cz = Math.sin(a),
              w = reach * 0.32,
              c0 = shade(C.pine, 0.75 + 0.2 * r()),
              c1 = shade(C.pine2, 0.9 + 0.3 * r());
            g.triS([-cz * w, y, cx * w], [cz * w, y, -cx * w], [cx * reach, y - reach * 0.25, cz * reach], [0, 1, 0], [0, 1, 0], [0, 1, 0], c0, c0, c1);
          }
        }
        g.cyl([0.02, h * 0.92, 0], [0.02, h + 0.14, 0], 0.03, 0, 4, C.pine2, C.pine2, false);
        break;
      }
      case "ivy": {
        // ivy creeping over the ground
        for (let k = 0; k < 14; k++) {
          const x = (r() - 0.5) * 0.9,
            z = (r() - 0.5) * 0.9,
            a = r() * TAU,
            w = 0.05 + r() * 0.04,
            y = 0.03 + r() * 0.05,
            c = shade(k % 4 ? C.ivy : C.ivy2, 0.8 + 0.4 * r()),
            fx = Math.cos(a),
            fz = Math.sin(a);
          g.triS([x - fz * w, y, z + fx * w], [x + fz * w, y, z - fx * w], [x + fx * w * 2.2, y - 0.015, z + fz * w * 2.2], [0, 1, 0], [0, 1, 0], [0, 1, 0], c, c, shade(c, 1.25));
        }
        g.cyl([-0.4, 0.02, -0.1], [0.4, 0.025, 0.15], 0.008, 0.008, 3, C.cane, C.cane, false);
        break;
      }
      case "tallgrass": {
        for (let k = 0; k < 12; k++) blade((r() - 0.5) * 0.5, (r() - 0.5) * 0.5, r() * TAU, 0.45 + r() * 0.5, 0.022, shade(C.fern, 0.6), shade(v ? C.hazel : C.fern2, 1.05));
        break;
      }
      case "stump": {
        // an old stump going back to the soil
        const rad = 0.2 + r() * 0.1,
          h = 0.25 + r() * 0.2;
        g.cyl([0, 0, 0], [0, h, 0], rad * 1.15, rad, 8, shade(C.bark, 0.75), C.bark, col(0x9a7b55));
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * TAU + r();
          g.cyl([Math.cos(a) * rad * 0.8, 0.12, Math.sin(a) * rad * 0.8], [Math.cos(a) * rad * 2.1, 0, Math.sin(a) * rad * 2.1], 0.07, 0.025, 4, C.bark, C.bark, false);
        }
        g.ball([rad * 0.4, h, -rad * 0.2], rad * 0.7, 0.05, rad * 0.6, C.moss, { flat: true, jit: 0.3, seed: v + 2, lat: 2, lon: 6 });
        g.cyl([rad * 1.1, h * 0.5, 0], [rad * 1.1, h * 0.5 + 0.02, 0], 0.08, 0.06, 6, C.shroomTan, shade(C.white, 0.9));
        break;
      }
      case "clod":
        for (let k = 0; k < 3; k++) g.ball([(r() - 0.5) * 0.3, 0.03, (r() - 0.5) * 0.3], 0.09 + r() * 0.07, 0.05, 0.1, shade(C.soil, 0.8 + 0.4 * r()), { flat: true, jit: 0.25, seed: k + v, lat: 2, lon: 5 });
        break;
    }
    const out = { p: new Float32Array(g.p), n: new Float32Array(g.n), c: new Float32Array(g.c) };
    templates.set(key, out);
    return out;
  }
  const litterMat = BL.texel(new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide }));

  function populate(ch) {
    const r = rng(strHash(ch.key) ^ 0x51ed),
      size = G.chunkSize,
      items = [],
      slope = (x, z) => Math.hypot(ch.baseLocal(x + 0.5, z) - ch.baseLocal(x - 0.5, z), ch.baseLocal(x, z + 0.5) - ch.baseLocal(x, z - 0.5));
    const put = (kind, lx, lz, s = 1) => items.push({ kind, v: Math.floor(r() * N_VAR), lx, lz, rot: r() * TAU, s: s * (0.8 + 0.5 * r()), tone: 0.82 + 0.36 * r() });
    for (let k = 0; k < 270; k++) {
      const lx = r() * size,
        lz = r() * size,
        pick = r(),
        h = ch.baseLocal(lx, lz);
      if (h < -0.5 || slope(lx, lz) > 0.8) continue;
      const f = G.forestAt(ch.ox + lx, ch.oz + lz);
      if (h < 0.25) {
        pick < 0.3 && put("reed", lx, lz);
      } else if (h < 1.3) {
        if (pick < 0.16 && h < 0.9) put("reed", lx, lz);
        else if (pick < 0.34) put("stone", lx, lz, 0.9);
        else if (pick < 0.42) put("drift", lx, lz);
      } else if (h > 19) {
        pick < 0.5 && put("stone", lx, lz, 1.5);
      } else if (f > 0.16) {
        if (pick < 0.4) put("fleck", lx, lz);
        else if (pick < 0.54) put("twig", lx, lz);
        else if (pick < 0.62) put("cone", lx, lz);
        else if (pick < 0.71) put("fern", lx, lz);
        else if (pick < 0.76) put("mossy", lx, lz);
        else if (pick < 0.795) put("shroom", lx, lz);
      } else {
        if (pick < 0.14) put("seedgrass", lx, lz);
        else if (pick < 0.19) put("stone", lx, lz, 0.8);
        else if (pick < 0.215) put("clod", lx, lz);
        else if (pick < 0.235) put("twig", lx, lz);
        else if (pick < 0.247 && f > 0.02) put("shrub", lx, lz);
      }
    }
    const PATCH = {
      rockfield: [["boulder", 2, 1], ["stone", 6, 1.3], ["gravel", 4, 1], ["slab", 1, 1]],
      outcrop: [["slab", 4, 1.2], ["boulder", 1, 1], ["gravel", 3, 1], ["mossy", 3, 1.2]],
      scree: [["gravel", 9, 1.2], ["stone", 7, 1.4], ["slab", 2, 1]],
      pebbles: [["gravel", 10, 1], ["stone", 5, 0.9], ["drift", 2, 1]],
      bramble: [["bramble", 6, 1], ["tallgrass", 3, 1]],
      thicket: [["bush", 3, 1], ["bramble", 2, 1], ["fern", 3, 1]],
      heath: [["heather", 9, 1], ["stone", 2, 1], ["tallgrass", 3, 1]],
      meadow: [["tallgrass", 10, 1], ["seedgrass", 5, 1]],
      glade: [["fern", 10, 1.1], ["mossy", 2, 1], ["shroom", 2, 1]],
      ivy: [["ivy", 12, 1], ["fern", 2, 1]],
      brush: [["twig", 7, 2.2], ["fleck", 5, 1], ["stump", 1, 1]],
      nursery: [["sapling", 5, 1], ["fern", 2, 1], ["cone", 3, 1]],
      stumps: [["stump", 2, 1], ["shroom", 3, 1], ["mossy", 2, 1]],
    };
    const nPatch = 5 + Math.floor(r() * 2);
    for (let k = 0; k < nPatch; k++) {
      const cx = r() * size,
        cz = r() * size,
        h = ch.baseLocal(cx, cz),
        pick = r(),
        rad = 2 + r() * 2.6;
      if (h < 0.3) continue;
      const f = G.forestAt(ch.ox + cx, ch.oz + cz),
        steep = slope(cx, cz) > 0.45;
      const opts = h > 19 ? ["scree", "outcrop", "rockfield"] : h < 1.3 ? ["pebbles", "pebbles", "rockfield"] : steep ? ["outcrop", "scree", "rockfield"] : f > 0.2 ? ["glade", "ivy", "brush", "thicket", "rockfield", "stumps", "bramble", "outcrop", "nursery"] : ["heath", "meadow", "meadow", "bramble", "thicket", "rockfield", "outcrop", f > 0.04 ? "nursery" : "heath"];
      for (const [kind, n, sc] of PATCH[opts[Math.floor(pick * opts.length)]])
        for (let q = 0; q < n; q++) {
          const lx = cx + (r() + r() - 1) * rad,
            lz = cz + (r() + r() - 1) * rad;
          if (lx < 0.5 || lz < 0.5 || lx > size - 0.5 || lz > size - 0.5 || ch.baseLocal(lx, lz) < 0.32 || slope(lx, lz) > 1.1) continue;
          put(kind, lx, lz, sc);
        }
    }
    // ivy climbs some of the forest trees
    ch.ivyTrees = [];
    for (const t of ch.trees) if (G.forestAt(t.x, t.z) > 0.22 && t.type !== 1 && r() < 0.3) ch.ivyTrees.push({ t, seed: Math.floor(r() * 9999), top: 1.4 + r() * 2.4, arc: r() < 0.5 ? TAU : 2 + r() * 2.5, a0: r() * TAU });
    // what each tree has dropped
    for (const t of ch.trees) {
      const n = t.type === 0 ? 3 : 2;
      for (let k = 0; k < n; k++) {
        const a = r() * TAU,
          d = 0.5 + r() * 1.6,
          lx = t.x - ch.ox + Math.cos(a) * d,
          lz = t.z - ch.oz + Math.sin(a) * d;
        if (lx < 0 || lz < 0 || lx >= size || lz >= size) continue;
        put(t.type === 0 ? (k ? "cone" : "fleck") : k ? "fleck" : "twig", lx, lz);
      }
    }
    // now and then a fallen trunk
    ch.fallen = [];
    if (r() < 0.55) {
      const lx = 4 + r() * (size - 8),
        lz = 4 + r() * (size - 8);
      if (G.forestAt(ch.ox + lx, ch.oz + lz) > 0.2 && ch.baseLocal(lx, lz) > 1.5 && slope(lx, lz) < 0.5) ch.fallen.push({ lx, lz, a: r() * TAU, len: 2.2 + r() * 1.6, rad: 0.17 + r() * 0.08, seed: Math.floor(r() * 99) });
    }
    ch.litterItems = items;
  }
  const ROCKY = { stone: 1, gravel: 1.1, clod: 1, boulder: 0.6, slab: 0.6, mossy: 0.5 };
  function refresh(ch) {
    if (!ch.litterItems) populate(ch);
    const pos = [],
      nor = [],
      colr = [];
    for (const it of ch.litterItems) {
      const h = ch.heightLocal(it.lx, it.lz);
      if (Math.abs(h - ch.baseLocal(it.lx, it.lz)) > 0.25 || (it.kind === "reed" ? h < -0.5 : h < 0.3)) continue;
      const tp = template(it.kind, it.v),
        c = Math.cos(it.rot) * it.s,
        s = Math.sin(it.rot) * it.s,
        x0 = ch.ox + it.lx,
        z0 = ch.oz + it.lz,
        cn = Math.cos(it.rot),
        sn = Math.sin(it.rot);
      // Loose stone takes on the ground it lies in: dusted with the local sand or soil, most of all near
      // its foot, and sunk a little so it reads as bedded rather than dropped on top.
      const rocky = ROCKY[it.kind],
        gc = rocky ? (h < 1.4 ? G.palette.sand : G.palette.dirt) : null,
        sink = rocky ? 0.07 * it.s : 0;
      for (let k = 0; k < tp.p.length; k += 3) {
        const py = tp.p[k + 1] * it.s;
        pos.push(x0 + tp.p[k] * c + tp.p[k + 2] * s, h + py - sink, z0 - tp.p[k] * s + tp.p[k + 2] * c);
        nor.push(tp.n[k] * cn + tp.n[k + 2] * sn, tp.n[k + 1], -tp.n[k] * sn + tp.n[k + 2] * cn);
        if (gc) {
          const m = rocky * (0.75 - 0.5 * clamp(py / 0.3, 0, 1));
          colr.push(lerp(tp.c[k] * it.tone, gc.r * 0.9, m), lerp(tp.c[k + 1] * it.tone, gc.g * 0.9, m), lerp(tp.c[k + 2] * it.tone, gc.b * 0.9, m));
        } else colr.push(tp.c[k] * it.tone, tp.c[k + 1] * it.tone, tp.c[k + 2] * it.tone);
      }
    }
    softenFoliage(ch);
    if (ch.rockMesh && !ch.rockMesh.material.userData.warm) {
      ch.rockMesh.material.userData.warm = true;
      ch.rockMesh.material.color.setRGB(1.0, 0.95, 0.84);
    }
    for (const iv of ch.ivyTrees) {
      const t = iv.t;
      if (!t.alive) continue;
      const rr = rng(iv.seed),
        wq = t.scale * (0.84 + ((t.rot * 7.31) % 1) * 0.34),
        sy = t.scale * (0.9 + ((t.rot * 3.17) % 1) * 0.24),
        gy = ch.heightLocal(t.x - ch.ox, t.z - ch.oz) - 0.08,
        girth = (y) => (t.type === 0 ? lerp(0.36, 0.24, clamp((y + 0.3) / 3.3, 0, 1)) : t.type === 1 ? lerp(0.2, 0.12, clamp(y / 3.6, 0, 1)) : lerp(0.46, 0.22, clamp(y / 2.8, 0, 1))),
        n = Math.round(26 * iv.top * (iv.arc / TAU) + 10);
      for (let k = 0; k < n; k++) {
        const y = iv.top * Math.pow(rr(), 1.5),
          a = iv.a0 + rr() * iv.arc,
          ox = Math.cos(a),
          oz = Math.sin(a),
          rad = girth(y) * wq + 0.025,
          w = 0.06 + rr() * 0.05,
          hh = 0.1 + rr() * 0.07,
          x = t.x + ox * rad,
          z = t.z + oz * rad,
          yy = gy + 0.12 + y * sy,
          tone = 1.0 + 0.45 * rr(),
          c = rr() < 0.2 ? C.ivy2 : C.ivy,
          lean = (rr() - 0.5) * 0.08;
        pos.push(x - oz * w, yy + hh * 0.5, z + ox * w, x + oz * w, yy + hh * 0.5 + lean, z - ox * w, x + ox * 0.03, yy - hh, z + oz * 0.03);
        for (let q = 0; q < 3; q++) (nor.push(ox * 0.6, 0.8, oz * 0.6), colr.push(c[0] * tone * (q === 2 ? 1.3 : 1), c[1] * tone * (q === 2 ? 1.3 : 1), c[2] * tone));
      }
    }
    if (ch.fallen.length) {
      const g = new Geo();
      for (const f of ch.fallen) {
        const dx = (Math.cos(f.a) * f.len) / 2,
          dz = (Math.sin(f.a) * f.len) / 2,
          ha = ch.heightLocal(f.lx - dx, f.lz - dz),
          hb = ch.heightLocal(f.lx + dx, f.lz + dz);
        if (Math.abs(ch.heightLocal(f.lx, f.lz) - ch.baseLocal(f.lx, f.lz)) > 0.25 || ha < 0.4 || hb < 0.4) continue;
        const a = [ch.ox + f.lx - dx, ha + f.rad * 0.8, ch.oz + f.lz - dz],
          b = [ch.ox + f.lx + dx, hb + f.rad * 0.7, ch.oz + f.lz + dz],
          end = col(0xb89468);
        g.cyl(a, b, f.rad, f.rad * 0.82, 8, shade(C.bark, 0.8), C.bark, end);
        // moss along the top, a snapped branch, bracket fungus
        for (let k = 0; k < 4; k++) {
          const t = 0.15 + 0.2 * k + 0.1 * hash(f.seed, k, 1),
            m = [lerp(a[0], b[0], t), lerp(a[1], b[1], t) + f.rad * 0.78, lerp(a[2], b[2], t)];
          g.ball(m, 0.22 + 0.12 * hash(f.seed, k, 2), 0.06, f.rad * 0.8, C.moss, { flat: true, jit: 0.25, seed: f.seed + k, lat: 2, lon: 6 });
        }
        const m = [lerp(a[0], b[0], 0.6), lerp(a[1], b[1], 0.6), lerp(a[2], b[2], 0.6)];
        g.cyl(m, [m[0] - dz * 0.25, m[1] + 0.35, m[2] + dx * 0.25], 0.045, 0.02, 4, C.bark, C.bark);
        for (let k = 0; k < 3; k++) {
          const t = 0.3 + 0.12 * k,
            q = [lerp(a[0], b[0], t) + (dz / f.len) * f.rad * 1.9, lerp(a[1], b[1], t) - 0.02 + k * 0.03, lerp(a[2], b[2], t) - (dx / f.len) * f.rad * 1.9];
          g.cyl(q, [q[0], q[1] + 0.025, q[2]], 0.09, 0.07, 6, C.shroomTan, shade(C.white, 0.9));
        }
      }
      for (let k = 0; k < g.p.length; k++) (pos.push(g.p[k]), nor.push(g.n[k]), colr.push(g.c[k]));
    }
    if (ch.litter) {
      ch.group.remove(ch.litter);
      ch.litter.geometry.dispose();
      ch.litter = null;
    }
    if (!pos.length) return;
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new T.Float32BufferAttribute(nor, 3));
    geo.setAttribute("color", new T.Float32BufferAttribute(colr, 3));
    geo.computeBoundingSphere();
    ch.litter = new T.Mesh(geo, litterMat);
    ch.litter.receiveShadow = true;
    ch.group.add(ch.litter);
  }
  // Tree foliage: shadows cast by one bough on the next are softened, light wraps round the needles
  // instead of cutting off at a hard edge, and boughs seen against the sun glow a little.
  const softened = new Set();
  function softenFoliage(ch) {
    const tree = (ch.treeMeshes || []).find(Boolean);
    tree && !softened.has(tree.material) && soften(tree.material, 0.5, "leaf");
    ch.grassMesh && !softened.has(ch.grassMesh.material) && soften(ch.grassMesh.material, 0.16, "grass");
    // the ground is lit the same way as the grass on it, so the two read as one surface
    ch.terrain && !softened.has(ch.terrain.material) && soften(ch.terrain.material, 0.16, "ground");
  }
  function soften(mat, floor, kind) {
    softened.add(mat);
    const before = mat.onBeforeCompile,
      keyBefore = mat.customProgramCacheKey,
      ground = kind === "ground";
    let begin = ORIG.begin,
      pars = ORIG.pars;
    const a = begin.replace(/(directLight\.color \*= \( directLight\.visible && receiveShadow \) \? )(getShadow\( directionalShadowMap[^;]*?\))( : 1\.0;)/, "$1 mix( " + (ground ? "vec3( 1.0 )" : "vec3( 0.9, 1.06, 0.55 )") + " * " + floor.toFixed(2) + ", vec3( 1.0 ), $2 ) : vec3( 1.0 );");
    let b = pars.replace(/float dotNL = saturate\( dot\( geometryNormal, directLight\.direction \) \);/, "float rawNL = dot( geometryNormal, directLight.direction );\n\tfloat dotNL = saturate( rawNL * 0.5 + 0.5 );" + (ground ? "" : "\n\tdotNL += 0.25 * pow( saturate( dot( normalize( vViewPosition ), directLight.direction ) * -1.0 ), 3.0 );"));
    // leaves pass light: the side turned from the sun still glows, yellow-green
    if (!ground) b = b.replace(/vec3 irradiance = dotNL \* directLight\.color;/, "vec3 irradiance = dotNL * directLight.color * mix( vec3( 0.95, 1.05, 0.6 ), vec3( 1.0 ), smoothstep( -0.3, 0.5, rawNL ) );");
    window.__nature_soft = [a !== begin, b !== pars];
    mat.onBeforeCompile = (sh, rnd) => {
      before && before(sh, rnd);
      sh.fragmentShader = sh.fragmentShader.replace("#include <lights_fragment_begin>", a).replace("#include <lights_lambert_pars_fragment>", b);
      // each tuft fades at its foot into the colour of the soil it stands in, so there is no hard line where
      // blade meets ground and the two read as one surface. (This used to punch a dot pattern through the foot instead, which showed as speckles.)
      if (kind === "grass")
        sh.fragmentShader = sh.fragmentShader.replace(
          "#include <alphatest_fragment>",
          "#include <alphatest_fragment>\n\t#ifdef USE_MAP\n\tdiffuseColor.rgb = mix( vColor.rgb * vec3( 0.82, 0.8, 0.86 ), diffuseColor.rgb, smoothstep( 0.0, 0.42, vMapUv.y ) );\n\t#endif",
        );
    };
    mat.customProgramCacheKey = () => (keyBefore ? keyBefore.call(mat) : "") + "soft3" + floor + kind;
    mat.needsUpdate = true;
  }
  function dispose(ch) {
    if (ch.litter) ch.litter.geometry.dispose();
    ch.litter = null;
  }

  /* ================= insects ================= */
  const BUGS = 22,
    bugGeo = new T.BufferGeometry(),
    bugPos = new Float32Array(BUGS * 36),
    bugCol = new Float32Array(BUGS * 36);
  bugGeo.setAttribute("position", new T.BufferAttribute(bugPos, 3));
  bugGeo.setAttribute("color", new T.BufferAttribute(bugCol, 3));
  const bugMesh = new T.Mesh(bugGeo, new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide }));
  bugMesh.frustumCulled = false;
  G.scene.add(bugMesh);
  const WING = [col(0xf2efe6), col(0xf0c93a), col(0xe8842c), col(0x5a8fd8), col(0xd96a9a)];
  const bugs = [];
  for (let k = 0; k < BUGS; k++) bugs.push({ live: false, k, dragon: k % 5 === 4, ph: k * 1.7, t: 0 });
  function placeBug(b) {
    // butterflies keep to open grass, dragonflies to the water's edge
    for (let tries = 0; tries < 6; tries++) {
      const a = Math.random() * TAU,
        d = 8 + Math.random() * 26,
        x = P.x + Math.cos(a) * d,
        z = P.z + Math.sin(a) * d,
        h = G.heightAt(x, z),
        f = G.forestAt(x, z);
      if (b.dragon ? h > -0.6 && h < 1.1 : h > 1.4 && h < 16 && f < 0.2) {
        Object.assign(b, { live: true, ax: x, az: z, x, z, y: Math.max(h, 0) + 0.8, tx: x, tz: z, ty: 1, yaw: a, t: 0 });
        const c = b.dragon ? col(0x3fb7a8) : WING[Math.floor(Math.random() * WING.length)];
        for (let v = 0; v < 12; v++) {
          const tipv = v % 3 === 2 ? 0.7 : 1;
          bugCol.set([c[0] * tipv, c[1] * tipv, c[2] * tipv], (b.k * 12 + v) * 3);
        }
        bugGeo.attributes.color.needsUpdate = true;
        return;
      }
    }
    b.live = false;
  }
  function updateBugs(dt, time) {
    const day = sun() > 0.02;
    for (const b of bugs) {
      const o = b.k * 36;
      if (!b.live || !day || Math.hypot(b.x - P.x, b.z - P.z) > 46) {
        b.live = false;
        bugPos.fill(0, o, o + 36);
        if (day && Math.random() < dt * 0.5) placeBug(b);
        continue;
      }
      b.t -= dt;
      if (b.t <= 0) {
        b.t = b.dragon ? 0.6 + Math.random() * 1.6 : 0.8 + Math.random() * 2;
        const a = Math.random() * TAU,
          d = Math.random() * (b.dragon ? 7 : 4);
        b.tx = b.ax + Math.cos(a) * d;
        b.tz = b.az + Math.sin(a) * d;
        b.ty = b.dragon ? 0.5 + Math.random() * 0.9 : 0.4 + Math.random() * 1.3;
      }
      const sp = b.dragon ? 5 : 1.5,
        dx = b.tx - b.x,
        dz = b.tz - b.z,
        d = Math.hypot(dx, dz) || 1;
      if (d > 0.15) {
        b.x += (dx / d) * Math.min(d, sp * dt);
        b.z += (dz / d) * Math.min(d, sp * dt);
        b.yaw = Math.atan2(dx, dz);
      }
      const gy = Math.max(G.heightAt(b.x, b.z), 0);
      b.y = lerp(b.y, gy + b.ty + (b.dragon ? 0 : 0.12 * Math.sin(time * 9 + b.ph)), Math.min(1, dt * 4));
      // two wings, each a pair of triangles, beating about the body line
      const flap = b.dragon ? 0.25 * Math.sin(time * 70 + b.ph) : 1.1 * Math.sin(time * (16 + (b.k % 3) * 3) + b.ph),
        span = b.dragon ? 0.26 : 0.17,
        len = b.dragon ? 0.07 : 0.15,
        fx = Math.sin(b.yaw),
        fz = Math.cos(b.yaw),
        rx = fz,
        rz = -fx,
        up = Math.sin(flap) * span,
        out = Math.cos(flap) * span;
      let q = o;
      for (const sd of [-1, 1]) {
        const tx = b.x + rx * out * sd,
          tz = b.z + rz * out * sd,
          ty = b.y + up;
        bugPos.set([b.x + fx * len, b.y, b.z + fz * len, b.x - fx * len * 0.4, b.y, b.z - fz * len * 0.4, tx + fx * len * 0.7, ty, tz + fz * len * 0.7], q);
        bugPos.set([b.x - fx * len * 0.4, b.y, b.z - fz * len * 0.4, b.x - fx * len, b.y, b.z - fz * len, tx - fx * len * 0.9, ty * 0.3 + b.y * 0.7, tz - fz * len * 0.9], q + 9);
        q += 18;
      }
    }
    bugGeo.attributes.position.needsUpdate = true;
  }

  /* ================= animals ================= */
  // An animal is one mesh made of parts; each part turns about its own pivot, and the vertices are moved by hand each frame.
  const animalMat = new T.MeshLambertMaterial({ vertexColors: true });
  function model(build) {
    const parts = [],
      part = (pivot, fn) => {
        const g = new Geo();
        fn(g);
        parts.push({ g, pivot });
      };
    build(part);
    let n = 0;
    for (const q of parts) n += q.g.p.length;
    const rest = new Float32Array(n),
      restN = new Float32Array(n),
      colr = new Float32Array(n),
      spans = [];
    let o = 0;
    for (const q of parts) {
      rest.set(q.g.p, o);
      restN.set(q.g.n, o);
      colr.set(q.g.c, o);
      spans.push([o, o + q.g.p.length, q.pivot]);
      o += q.g.p.length;
    }
    return { rest, restN, colr, spans };
  }
  function instance(m) {
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(new Float32Array(m.rest), 3));
    geo.setAttribute("normal", new T.BufferAttribute(new Float32Array(m.restN), 3));
    geo.setAttribute("color", new T.BufferAttribute(m.colr, 3));
    geo.computeBoundingSphere();
    geo.boundingSphere.radius *= 1.6;
    const mesh = new T.Mesh(geo, animalMat);
    mesh.castShadow = true;
    return mesh;
  }
  // rot: one [rx, ry, rz] per part, or null to leave the part at rest
  function pose(mesh, m, rot) {
    const p = mesh.geometry.attributes.position.array,
      nn = mesh.geometry.attributes.normal.array;
    for (let k = 0; k < m.spans.length; k++) {
      const [a, b, pv] = m.spans[k],
        r = rot[k];
      if (!r || (!r[0] && !r[1] && !r[2])) {
        if (mesh.userData["d" + k]) {
          p.set(m.rest.subarray(a, b), a);
          nn.set(m.restN.subarray(a, b), a);
          mesh.userData["d" + k] = false;
        }
        continue;
      }
      mesh.userData["d" + k] = true;
      const cx = Math.cos(r[0]),
        sx = Math.sin(r[0]),
        cy = Math.cos(r[1]),
        sy = Math.sin(r[1]),
        cz = Math.cos(r[2]),
        sz = Math.sin(r[2]);
      // R = Ry * Rx * Rz
      const m00 = cy * cz + sy * sx * sz,
        m01 = -cy * sz + sy * sx * cz,
        m02 = sy * cx,
        m10 = cx * sz,
        m11 = cx * cz,
        m12 = -sx,
        m20 = -sy * cz + cy * sx * sz,
        m21 = sy * sz + cy * sx * cz,
        m22 = cy * cx;
      for (let i = a; i < b; i += 3) {
        const x = m.rest[i] - pv[0],
          y = m.rest[i + 1] - pv[1],
          z = m.rest[i + 2] - pv[2];
        p[i] = pv[0] + m00 * x + m01 * y + m02 * z;
        p[i + 1] = pv[1] + m10 * x + m11 * y + m12 * z;
        p[i + 2] = pv[2] + m20 * x + m21 * y + m22 * z;
        const u = m.restN[i],
          v = m.restN[i + 1],
          w = m.restN[i + 2];
        nn[i] = m00 * u + m01 * v + m02 * w;
        nn[i + 1] = m10 * u + m11 * v + m12 * w;
        nn[i + 2] = m20 * u + m21 * v + m22 * w;
      }
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.attributes.normal.needsUpdate = true;
  }
  const DARK = col(0x241d18),
    CREAM = col(0xe9dfc8);
  // four-legged body plan shared by the deer and the fox. Parts: 0 body, 1 head and neck, 2 tail, 3-6 legs (front left, front right, back left, back right)
  function quadruped(o) {
    return model((part) => {
      const { h, len, rad, coat, under, leg } = o;
      part([0, h, 0], (g) => {
        g.ball([0, h, 0], rad, rad * 1.05, len, coat, { lat: 5, lon: 9 });
        g.ball([0, h - rad * 0.4, 0], rad * 0.8, rad * 0.75, len * 0.82, under, { lat: 3, lon: 7 });
        g.ball([0, h + rad * 0.1, len * 0.75], rad * 0.78, rad * 0.9, rad * 0.8, coat, { lat: 4, lon: 7 });
        o.rump && g.ball([0, h + rad * 0.02, -len * 0.82], rad * 0.5, rad * 0.6, rad * 0.3, CREAM, { lat: 3, lon: 6 });
      });
      const nb = [0, h + rad * 0.5, len * 0.8],
        hd = [0, nb[1] + o.neck * 0.85, nb[2] + o.neck * 0.5 + o.reach];
      part(nb, (g) => {
        g.cyl([0, h + rad * 0.2, len * 0.78], hd, rad * 0.5, rad * 0.34, 7, coat, coat);
        g.ball([hd[0], hd[1] + o.head * 0.3, hd[2] + o.head * 0.5], o.head * 0.95, o.head, o.head * 1.4, coat, { lat: 4, lon: 7 });
        const sn = [0, hd[1] + o.head * 0.05, hd[2] + o.head * 1.2 + o.snout];
        g.cyl([0, hd[1] + o.head * 0.25, hd[2] + o.head * 1.2], sn, o.head * 0.68, o.head * 0.34, 6, coat, o.muzzle || shade(coat, 0.8));
        g.ball(sn, o.head * 0.3, o.head * 0.26, o.head * 0.26, DARK, { lat: 2, lon: 5 });
        for (const sx of [-1, 1]) {
          g.ball([sx * o.head * 0.8, hd[1] + o.head * 0.55, hd[2] + o.head * 1.05], 0.022, 0.022, 0.022, DARK, { lat: 2, lon: 4 });
          g.cyl([sx * o.head * 0.6, hd[1] + o.head * 1.0, hd[2] + o.head * 0.3], [sx * o.head * (o.earOut || 1.9), hd[1] + o.head * 2.1 * (o.earUp || 1), hd[2] + o.head * 0.05], o.head * 0.45, 0.008, 5, shade(coat, 0.75), coat, undefined, 0.4);
          if (o.antlers) {
            const A = (a, b) => g.cyl(a, b, 0.02, 0.012, 4, CREAM, CREAM, false),
              y0 = hd[1] + o.head * 1.2,
              z0 = hd[2] + o.head * 0.4;
            A([sx * 0.05, y0, z0], [sx * 0.2, y0 + 0.3, z0 - 0.12]);
            A([sx * 0.2, y0 + 0.3, z0 - 0.12], [sx * 0.3, y0 + 0.56, z0 - 0.03]);
            A([sx * 0.12, y0 + 0.16, z0 - 0.06], [sx * 0.14, y0 + 0.34, z0 + 0.12]);
            A([sx * 0.2, y0 + 0.3, z0 - 0.12], [sx * 0.36, y0 + 0.4, z0 - 0.24]);
          }
        }
      });
      part([0, h + rad * 0.5, -len * 0.95], (g) => o.tail(g, [0, h + rad * 0.5, -len * 0.95]));
      for (const sz of [1, -1])
        for (const sx of [1, -1]) {
          const hip = [sx * rad * 0.55, h - rad * 0.3, sz * len * 0.66];
          part(hip, (g) => {
            const knee = [hip[0], hip[1] * 0.5, hip[2] + (sz < 0 ? -0.05 : 0.03) * (h / 0.95)];
            g.cyl([hip[0], hip[1] + rad * 0.3, hip[2]], knee, rad * 0.3, rad * 0.17, 6, coat, leg);
            g.cyl(knee, [hip[0], 0.03, hip[2]], rad * 0.15, rad * 0.11, 5, leg, leg);
            g.cyl([hip[0], 0.03, hip[2]], [hip[0], 0, hip[2] + 0.02], rad * 0.14, rad * 0.14, 5, DARK, DARK);
          });
        }
    });
  }
  const TAN = col(0x9c7652),
    FOX = col(0xc9692a);
  const deerCfg = { h: 0.98, len: 0.6, rad: 0.27, coat: TAN, under: shade(CREAM, 0.9), leg: col(0x6f5338), rump: true, neck: 0.5, reach: 0.02, head: 0.1, snout: 0.16, tail: (g, p) => g.cyl(p, [0, p[1] - 0.2, p[2] - 0.1], 0.05, 0.02, 5, CREAM, CREAM) };
  const MODELS = {
    doe: quadruped(deerCfg),
    stag: quadruped({ ...deerCfg, antlers: true, rad: 0.29, coat: col(0x8a6646) }),
    fox: quadruped({
      h: 0.4,
      len: 0.3,
      rad: 0.12,
      coat: FOX,
      under: CREAM,
      leg: DARK,
      neck: 0.14,
      reach: 0.03,
      head: 0.075,
      snout: 0.1,
      muzzle: CREAM,
      earOut: 1.2,
      earUp: 1.25,
      tail: (g, p) => {
        g.cyl(p, [0, p[1] - 0.06, p[2] - 0.34], 0.05, 0.1, 7, FOX, FOX);
        g.cyl([0, p[1] - 0.06, p[2] - 0.34], [0, p[1] - 0.04, p[2] - 0.52], 0.1, 0.02, 7, CREAM, CREAM);
      },
    }),
    // rabbit parts: 0 body, 1 ears
    rabbit: model((part) => {
      const c = col(0x8d7a66);
      part([0, 0.14, 0], (g) => {
        g.ball([0, 0.15, 0], 0.1, 0.11, 0.17, c, { lat: 4, lon: 8 });
        g.ball([0, 0.24, 0.17], 0.075, 0.075, 0.085, c, { lat: 4, lon: 7 });
        g.ball([0, 0.16, -0.17], 0.045, 0.045, 0.045, CREAM, { lat: 3, lon: 5 });
        for (const sx of [-1, 1]) {
          g.ball([sx * 0.085, 0.07, -0.08], 0.045, 0.07, 0.1, shade(c, 0.9), { lat: 3, lon: 6 });
          g.cyl([sx * 0.05, 0.12, 0.12], [sx * 0.05, 0, 0.14], 0.025, 0.02, 4, c, c);
          g.ball([sx * 0.055, 0.27, 0.22], 0.014, 0.014, 0.014, DARK, { lat: 2, lon: 4 });
        }
      });
      part([0, 0.3, 0.14], (g) => {
        for (const sx of [-1, 1]) g.cyl([sx * 0.035, 0.29, 0.15], [sx * 0.06, 0.5, 0.1], 0.03, 0.014, 5, c, shade(c, 1.15), undefined, 0.4);
      });
    }),
    // squirrel parts: 0 body, 1 tail
    squirrel: model((part) => {
      const c = col(0xa5552b);
      part([0, 0.1, 0], (g) => {
        g.ball([0, 0.1, 0], 0.055, 0.06, 0.11, c, { lat: 4, lon: 7 });
        g.ball([0, 0.16, 0.12], 0.045, 0.045, 0.055, c, { lat: 3, lon: 6 });
        g.ball([0, 0.07, 0.03], 0.04, 0.04, 0.08, CREAM, { lat: 3, lon: 5 });
        for (const sx of [-1, 1]) {
          g.cyl([sx * 0.025, 0.2, 0.11], [sx * 0.035, 0.25, 0.1], 0.015, 0.004, 4, c, c);
          g.cyl([sx * 0.04, 0.06, 0.08], [sx * 0.045, 0, 0.1], 0.015, 0.012, 4, c, c);
          g.ball([sx * 0.05, 0.04, -0.06], 0.025, 0.04, 0.05, c, { lat: 2, lon: 5 });
        }
      });
      part([0, 0.1, -0.1], (g) => {
        g.ball([0, 0.14, -0.15], 0.05, 0.07, 0.07, c, { lat: 3, lon: 6 });
        g.ball([0, 0.25, -0.19], 0.06, 0.09, 0.065, shade(c, 1.1), { lat: 3, lon: 6 });
        g.ball([0, 0.35, -0.14], 0.05, 0.06, 0.06, shade(c, 1.2), { lat: 3, lon: 6 });
      });
    }),
    // frog: one part
    frog: model((part) => {
      const c = col(0x5c8a35);
      part([0, 0, 0], (g) => {
        g.ball([0, 0.05, 0], 0.07, 0.05, 0.09, c, { lat: 3, lon: 7 });
        g.ball([0, 0.035, 0.01], 0.06, 0.035, 0.08, col(0xc9c98a), { lat: 2, lon: 6 });
        for (const sx of [-1, 1]) {
          g.ball([sx * 0.035, 0.095, 0.05], 0.02, 0.02, 0.02, DARK, { lat: 2, lon: 4 });
          g.ball([sx * 0.075, 0.03, -0.06], 0.03, 0.03, 0.07, shade(c, 0.85), { lat: 2, lon: 5 });
        }
      });
    }),
  };
  // birds: 0 body, 1 left wing, 2 right wing. Three liveries, and a duck.
  const birdModel = (back, breast, cap, s = 1) =>
    model((part) => {
      part([0, 0.08 * s, 0], (g) => {
        g.ball([0, 0.08 * s, 0], 0.05 * s, 0.055 * s, 0.085 * s, back, { lat: 4, lon: 7 });
        g.ball([0, 0.07 * s, 0.03 * s], 0.045 * s, 0.05 * s, 0.06 * s, breast, { lat: 3, lon: 6 });
        g.ball([0, 0.15 * s, 0.065 * s], 0.038 * s, 0.038 * s, 0.042 * s, cap, { lat: 3, lon: 6 });
        g.cyl([0, 0.145 * s, 0.1 * s], [0, 0.14 * s, 0.15 * s], 0.014 * s, 0.002, 4, col(0xd9a441), col(0xd9a441));
        g.tri([-0.03 * s, 0.09 * s, -0.07 * s], [0.03 * s, 0.09 * s, -0.07 * s], [0, 0.1 * s, -0.19 * s], [0, 1, 0], shade(back, 0.8));
        for (const sx of [-1, 1]) {
          g.ball([sx * 0.03 * s, 0.165 * s, 0.085 * s], 0.008 * s, 0.008 * s, 0.008 * s, DARK, { lat: 2, lon: 4 });
          g.cyl([sx * 0.02 * s, 0.04 * s, 0], [sx * 0.022 * s, 0, 0.01 * s], 0.006 * s, 0.006 * s, 3, DARK, DARK, false);
        }
      });
      for (const sx of [1, -1])
        part([sx * 0.04 * s, 0.1 * s, 0.01 * s], (g) => {
          const a = [sx * 0.04 * s, 0.1 * s, 0.06 * s],
            b = [sx * 0.04 * s, 0.1 * s, -0.05 * s],
            c = [sx * 0.2 * s, 0.1 * s, 0.02 * s],
            d = [sx * 0.17 * s, 0.1 * s, -0.07 * s];
          g.tri(a, b, c, [0, 1, 0], shade(back, 0.9));
          g.tri(b, d, c, [0, 1, 0], shade(back, 0.7));
        });
    });
  MODELS.robin = birdModel(col(0x6e5a47), col(0xd9632a), col(0x6e5a47), 1.7);
  MODELS.tit = birdModel(col(0x4f7fc2), col(0xe9cf4a), col(0x2f4f8a), 1.5);
  MODELS.sparrow = birdModel(col(0x8a6a4a), col(0xcbbfa8), col(0x5a4030), 1.5);
  MODELS.crow = birdModel(col(0x1d1d22), col(0x26262c), col(0x1d1d22), 3.2);
  MODELS.duck = model((part) => {
    const b = col(0x8b7355),
      gr = col(0x245c3a);
    part([0, 0, 0], (g) => {
      g.ball([0, 0.07, 0], 0.11, 0.09, 0.19, b, { lat: 4, lon: 8 });
      g.ball([0, 0.08, -0.18], 0.05, 0.05, 0.06, CREAM, { lat: 2, lon: 5 });
      g.cyl([0, 0.1, 0.13], [0, 0.26, 0.17], 0.045, 0.035, 6, CREAM, gr);
      g.ball([0, 0.29, 0.18], 0.05, 0.05, 0.06, gr, { lat: 3, lon: 6 });
      g.cyl([0, 0.28, 0.22], [0, 0.27, 0.31], 0.028, 0.02, 4, col(0xd9b23a), col(0xd9b23a), undefined, 0.45);
    });
  });

  // alert: how near you may come. calm: how far it runs before settling. where: (height, forest) -> can it live here
  const KINDS = {
    deer: { models: ["doe", "doe", "stag"], cap: 4, group: 3, walk: 1.1, run: 8.5, alert: 13, calm: 30, r: 0.4, where: (h, f) => h > 1.6 && h < 17 && f > 0.03 && f < 0.42, night: true },
    rabbit: { models: ["rabbit"], cap: 5, group: 2, walk: 1.3, run: 6.5, alert: 7, calm: 18, r: 0.15, where: (h, f) => h > 1.5 && h < 15 && f < 0.22 },
    squirrel: { models: ["squirrel"], cap: 4, group: 1, walk: 1.6, run: 5.5, alert: 6.5, calm: 14, r: 0.1, where: (h, f) => h > 1.5 && h < 17 && f > 0.24 },
    fox: { models: ["fox"], cap: 1, group: 1, walk: 1.4, run: 7.5, alert: 11, calm: 28, r: 0.25, where: (h, f) => h > 1.5 && h < 16 && f > 0.05, night: true },
    bird: { models: ["robin", "tit", "sparrow", "sparrow"], cap: 7, group: 3, walk: 0.7, run: 7, alert: 6, calm: 99, r: 0.1, where: (h) => h > 1.4 && h < 18 },
    frog: { models: ["frog"], cap: 4, group: 2, walk: 0.8, run: 3, alert: 3.5, calm: 99, r: 0.08, where: (h) => h > 0.3 && h < 1.1, night: true },
    duck: { models: ["duck"], cap: 3, group: 2, walk: 0.5, run: 2.2, alert: 7, calm: 16, r: 0.2, where: (h) => h > -2.2 && h < -0.35, night: true, swims: true },
    crow: { models: ["crow"], cap: 2, group: 1, walk: 0, run: 0, alert: 0, calm: 0, r: 0, where: () => true, soars: true },
  };
  const animals = [];
  let spawnT = 2;
  const count = (kind) => animals.reduce((n, a) => n + (a.kind === kind ? 1 : 0), 0);
  function add(kind, x, z, home) {
    const def = KINDS[kind],
      name = def.models[Math.floor(Math.random() * def.models.length)],
      m = MODELS[name],
      mesh = instance(m);
    G.scene.add(mesh);
    const a = { kind, def, m, mesh, name, x, z, y: G.heightAt(x, z), yaw: Math.random() * TAU, want: 0, state: "idle", t: 1 + Math.random() * 4, ph: Math.random() * 9, home: home || [x, z], gait: 0, graze: 0, air: 0, vy: 0, s: 0.9 + Math.random() * 0.2 };
    a.want = a.yaw;
    mesh.scale.setScalar(a.s);
    if (def.soars) Object.assign(a, { state: "soar", cx: x, cz: z, rad: 14 + Math.random() * 14, ang: Math.random() * TAU, alt: 17 + Math.random() * 9 });
    animals.push(a);
    return a;
  }
  function remove(a) {
    G.scene.remove(a.mesh);
    a.mesh.geometry.dispose();
    animals.splice(animals.indexOf(a), 1);
  }
  function trySpawn() {
    const day = sun() > -0.05,
      low = G.quality() !== "high";
    const kinds = Object.keys(KINDS).filter((k) => (day || KINDS[k].night) && count(k) < Math.ceil(KINDS[k].cap * (low ? 0.6 : 1)));
    if (!kinds.length) return;
    const kind = kinds[Math.floor(Math.random() * kinds.length)],
      def = KINDS[kind],
      a = Math.random() * TAU,
      d = 40 + Math.random() * 20,
      x = P.x + Math.cos(a) * d,
      z = P.z + Math.sin(a) * d;
    if (!def.where(G.heightAt(x, z), G.forestAt(x, z))) return;
    const n = 1 + Math.floor(Math.random() * def.group);
    for (let k = 0; k < n && count(kind) < def.cap; k++) {
      const px = x + (Math.random() - 0.5) * 5 * k,
        pz = z + (Math.random() - 0.5) * 5 * k;
      def.where(G.heightAt(px, pz), G.forestAt(px, pz)) && add(kind, px, pz, [x, z]);
    }
  }
  const nearestTree = (x, z, reach) => {
    let best = null,
      bd = reach;
    const cs = G.chunkSize;
    for (const ch of W.chunks.values()) {
      if (Math.abs(ch.ox + cs / 2 - x) > cs || Math.abs(ch.oz + cs / 2 - z) > cs) continue;
      for (const t of ch.trees) {
        if (!t.alive) continue;
        const d = Math.hypot(t.x - x, t.z - z);
        if (d < bd) ((bd = d), (best = t));
      }
    }
    return best;
  };
  // one step over the ground; false if the way is barred by water, a steep bank or a wall
  function walk(a, speed, dt) {
    const nx = a.x + Math.sin(a.yaw) * speed * dt,
      nz = a.z + Math.cos(a.yaw) * speed * dt,
      h = G.heightAt(nx, nz);
    if (a.def.swims ? h > -0.3 : h < 0.32 || Math.abs(h - G.heightAt(a.x, a.z)) > 0.9 * Math.max(0.3, speed * dt * 6)) return false;
    const e = { x: nx, z: nz, y: h + 0.2 };
    BL.collide(e, a.def.r + 0.1, false);
    if (Math.hypot(e.x - nx, e.z - nz) > 0.02 && Math.hypot(e.x - a.x, e.z - a.z) < speed * dt * 0.3) return false;
    a.x = e.x;
    a.z = e.z;
    return true;
  }
  const turn = (a, dt, rate) => {
    const d = Math.atan2(Math.sin(a.want - a.yaw), Math.cos(a.want - a.yaw));
    a.yaw += clamp(d, -rate * dt, rate * dt);
  };
  const R0 = [0, 0, 0];
  function updateAnimal(a, dt, time) {
    const def = a.def,
      dx = a.x - P.x,
      dz = a.z - P.z,
      d = Math.hypot(dx, dz),
      rot = [];
    let pitch = 0,
      lift = 0,
      roll = 0;
    if (a.state === "soar") {
      // crows wheel high overhead
      a.ang += (dt * 5.5) / a.rad;
      a.cx = lerp(a.cx, P.x, dt * 0.02);
      a.cz = lerp(a.cz, P.z, dt * 0.02);
      a.x = a.cx + Math.cos(a.ang) * a.rad;
      a.z = a.cz + Math.sin(a.ang) * a.rad;
      a.yaw = Math.atan2(-Math.sin(a.ang), Math.cos(a.ang));
      a.y = Math.max(G.heightAt(a.x, a.z), 0) + a.alt + Math.sin(time * 0.3 + a.ph) * 1.5;
      const fl = 0.15 + 0.45 * Math.max(0, Math.sin(time * 0.7 + a.ph)) * Math.sin(time * 7 + a.ph);
      rot[1] = [0, 0, -fl];
      rot[2] = [0, 0, fl];
      roll = -0.3;
      if (sun() < -0.1) return remove(a);
    } else if (a.state === "fly") {
      // a startled bird climbs away and is gone
      a.t -= dt;
      a.x += Math.sin(a.yaw) * 7 * dt;
      a.z += Math.cos(a.yaw) * 7 * dt;
      a.y += (3.2 + a.t * 0.4) * dt;
      const fl = Math.sin(time * 26 + a.ph) * 1.0;
      rot[1] = [0, 0, -fl];
      rot[2] = [0, 0, fl];
      pitch = -0.35;
      if (a.t <= 0) return remove(a);
    } else if (a.state === "climb" || a.state === "perch") {
      // a squirrel goes up the far side of its tree and comes down when you have gone
      const t = a.tree,
        top = 2.4 + (a.ph % 1.5);
      if (!t || !t.alive) ((a.state = "idle"), (a.y = G.heightAt(a.x, a.z)));
      else {
        const ground = G.heightAt(t.x, t.z),
          tr = G.treeKinds[t.type].r * t.scale + 0.05;
        a.x = t.x - Math.sin(a.yaw) * tr;
        a.z = t.z - Math.cos(a.yaw) * tr;
        pitch = -Math.PI / 2;
        if (a.state === "climb") {
          a.y = Math.min(ground + top, a.y + 4.5 * dt);
          if (a.y >= ground + top) ((a.state = "perch"), (a.t = 4));
        } else if (d > 11) {
          a.t -= dt;
          if (a.t <= 0) {
            pitch = Math.PI / 2;
            a.y -= 3 * dt;
            if (a.y <= ground + 0.25) ((a.state = "idle"), (a.t = 1), (a.y = ground), (a.home = [a.x, a.z]));
          }
        } else a.t = 4;
        rot[1] = [0.5 * Math.sin(time * 5 + a.ph), 0, 0];
      }
    } else {
      const scared = d < def.alert * (a.state === "flee" ? 1.25 : 1);
      if (scared && a.state !== "flee") {
        if (a.kind === "bird") {
          a.state = "fly";
          a.t = 4.5;
          a.yaw = Math.atan2(dx, dz) + (Math.random() - 0.5);
          return;
        }
        a.state = "flee";
        a.jink = 0;
        if (a.kind === "squirrel") a.tree = nearestTree(a.x, a.z, 16);
      }
      if (a.state === "flee") {
        a.jink -= dt;
        if (a.kind === "squirrel" && a.tree) {
          a.want = Math.atan2(a.tree.x - a.x, a.tree.z - a.z);
          if (Math.hypot(a.tree.x - a.x, a.tree.z - a.z) < 0.5) {
            a.state = "climb";
            a.yaw = a.want;
            return;
          }
        } else if (a.jink <= 0) {
          a.jink = a.kind === "rabbit" ? 0.35 + Math.random() * 0.4 : 0.8;
          a.want = Math.atan2(dx, dz) + (Math.random() - 0.5) * (a.kind === "rabbit" ? 1.5 : 0.6);
        }
        turn(a, dt, 7);
        if (!walk(a, def.run, dt)) ((a.want += 1.3), (a.yaw += 1.3 * Math.min(1, dt * 8)));
        a.gait += dt * def.run * (a.kind === "deer" ? 1.5 : 3.2);
        if (a.kind === "frog" && G.heightAt(a.x, a.z) < 0.36) {
          G.burst(a.x, 0.1, a.z, 5, 0xbfd9e6, 1.2, 2, 0.08, 0.4);
          return remove(a);
        }
        if (d > def.calm) ((a.state = "idle"), (a.t = 2 + Math.random() * 3), (a.home = [a.x, a.z]));
      } else if (a.state === "walk") {
        const tx = a.tx - a.x,
          tz = a.tz - a.z;
        a.want = Math.atan2(tx, tz);
        turn(a, dt, 3);
        a.t -= dt;
        if (!walk(a, def.walk, dt) || Math.hypot(tx, tz) < 0.4 || a.t <= 0) ((a.state = "idle"), (a.t = 2 + Math.random() * 6), (a.grazing = Math.random() < 0.7));
        a.gait += dt * def.walk * (a.kind === "deer" ? 5 : 9);
      } else {
        a.t -= dt;
        if (a.t <= 0) {
          const an = Math.random() * TAU,
            r = 2 + Math.random() * (a.kind === "deer" ? 9 : 5);
          a.tx = a.home[0] + Math.cos(an) * r;
          a.tz = a.home[1] + Math.sin(an) * r;
          a.state = "walk";
          a.t = 8;
        }
      }
      a.y = a.def.swims ? G.waveHeight(a.x, a.z) - 0.03 : G.heightAt(a.x, a.z);
      const moving = a.state !== "idle",
        running = a.state === "flee",
        sw = Math.sin(a.gait);
      a.graze = lerp(a.graze, a.state === "idle" && a.grazing ? 1 : 0, Math.min(1, dt * 3));
      if (a.kind === "deer" || a.kind === "fox") {
        const amp = moving ? (running ? 0.85 : 0.45) : 0;
        if (running) {
          // a bounding gallop: front pair, then back pair
          rot[3] = rot[4] = [sw * amp, 0, 0];
          rot[5] = rot[6] = [-Math.cos(a.gait) * amp, 0, 0];
          lift = Math.max(0, sw) * (a.kind === "deer" ? 0.32 : 0.14);
          pitch = Math.cos(a.gait) * 0.12;
        } else {
          rot[3] = rot[6] = [sw * amp, 0, 0];
          rot[4] = rot[5] = [-sw * amp, 0, 0];
        }
        rot[1] = [a.graze * (a.kind === "deer" ? 1.25 : 0.7) + (moving ? 0.05 * Math.sin(a.gait * 2) : 0.04 * Math.sin(time * 1.3 + a.ph)), a.graze ? 0 : 0.35 * Math.sin(time * 0.5 + a.ph) * (moving ? 0 : 1), 0];
        rot[2] = [running ? -0.9 : 0, 0, 0.5 * Math.sin(time * (running ? 14 : 3) + a.ph) * (running || Math.sin(time * 0.7 + a.ph) > 0.6 ? 1 : 0)];
      } else if (a.kind === "rabbit" || a.kind === "frog" || a.kind === "squirrel") {
        // hoppers: an arc for every stride
        const hop = moving ? Math.abs(sw) : 0;
        lift = hop * (a.kind === "rabbit" ? (running ? 0.3 : 0.14) : a.kind === "frog" ? 0.22 : 0.08);
        pitch = moving ? -Math.cos(a.gait * 2) * 0.25 * (sw > 0 ? 1 : -1) : a.kind === "rabbit" && Math.sin(time * 0.4 + a.ph) > 0.8 ? -0.7 : 0;
        if (a.kind === "rabbit") rot[1] = [running ? -1.1 : 0.15 * Math.sin(time * 2 + a.ph), 0, 0];
        if (a.kind === "squirrel") rot[1] = [(moving ? -0.9 : 0) + 0.2 * Math.sin(time * 6 + a.ph), 0, 0];
      } else if (a.kind === "bird") {
        // hop, peck, look about
        lift = moving ? Math.abs(Math.sin(a.gait * 1.5)) * 0.07 : 0;
        pitch = a.graze * (0.5 + 0.5 * Math.sin(time * 9 + a.ph)) * 0.9;
        rot[1] = [0, 0, 1.25];
        rot[2] = [0, 0, -1.25];
      } else if (a.kind === "duck") {
        roll = 0.06 * Math.sin(time * 2.2 + a.ph);
        pitch = a.graze * 0.25 * Math.max(0, Math.sin(time * 1.1 + a.ph));
      }
    }
    for (let k = 0; k < a.m.spans.length; k++) rot[k] = rot[k] || R0;
    if (d < 70) pose(a.mesh, a.m, rot);
    a.mesh.position.set(a.x, a.y + lift * a.s, a.z);
    a.mesh.rotation.set(pitch, a.yaw, roll, "YXZ");
    if (d > 92 || (!def.night && sun() < -0.15 && d > 30)) remove(a);
  }

  /* ================= wiring ================= */
  window.__nature = { populate, refresh, dispose, animals, bugs, add, KINDS, template };
  for (const ch of W.chunks.values()) {
    populate(ch);
    refresh(ch);
  }
  const inner = BL.update;
  let time = 0;
  BL.update = (dt) => {
    inner(dt);
    time += dt;
    updateBugs(dt, time);
    spawnT -= dt;
    if (spawnT <= 0) {
      spawnT = 1.2;
      trySpawn();
    }
    for (let k = animals.length - 1; k >= 0; k--) updateAnimal(animals[k], dt, time);
    // distant pines are drawn from a much lighter model
    lodT -= dt;
    if (lodT <= 0) {
      lodT = 0.4;
      const far = G.quality() === "high" ? 58 : 34,
        cs = G.chunkSize;
      for (const ch of W.chunks.values()) {
        const m = ch.treeMeshes && ch.treeMeshes[0];
        if (!m) continue;
        const want = Math.hypot(ch.ox + cs / 2 - P.x, ch.oz + cs / 2 - P.z) > far ? G.pineLite : G.treeGeo[0];
        if (m.geometry !== want) m.geometry = want;
      }
    }
  };
  let lodT = 0;
  const innerReset = BL.reset;
  BL.reset = () => {
    innerReset();
    while (animals.length) remove(animals[0]);
    for (const b of bugs) b.live = false;
  };
})();
