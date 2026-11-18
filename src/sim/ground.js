// The ground system: owns the macro grid (1 m points, machine scale; core/ground.js) and is the one command API that
// moves earth at any scale: shovels, build-site prep and machine implements all go through ground.cut / fill / push /
// grade / trim / tamp. Still generic: the base height comes from the host (setGroundBase) and the fine grid and flag
// bits come through the factory.
//
// state sys.ground = { v: 1, macro, rev, totals: { cutM3, fillM3 }, pending: [[x, z, r, on]] }
// events: 'ground.macro' { keys } after any macro change (the engine mirrors those tiles into its terrain).
// Fine-grid changes only bump the fine grid's rev (whoever draws it watches that).

import * as GC from './core/ground.js';
import * as EW from './core/earthwork.js';
import { base64ToF32 } from './save.js';

// The untouched land, (x, z) -> metres. Must be pure of the seed (replays). The engine passes its terrain height.
let baseFn = () => 0;
export function setGroundBase(fn) { baseFn = typeof fn === 'function' ? fn : () => 0; }
const base = (x, z) => baseFn(x, z);

export function freshGround() { return { ...GC.makeGround(), totals: { cutM3: 0, fillM3: 0 }, pending: [] }; }

// Until the fine grid moves into this system (slice A5), it lives in the landscape's state and this system writes it.
// That breaks "write only your own state" on purpose, for now: it keeps the landscaping files untouched while that
// work is in flight. `fineOf(get)` is the one place that knows where it is.
const defaultFineOf = (get) => (get('landscape') && get('landscape').grid) || null;
let fineOfRead = defaultFineOf;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const fail = (reason) => ({ ok: false, reason });
const hours = (ctx) => Math.round((ctx.lifeT ?? ctx.t) / 3600);
const KEY = /^-?\d+,-?\d+$/;
const okPt = (p) => Array.isArray(p) && num(p[0]) && num(p[1]);

function ensure(ctx) {
  const s = ctx.s;
  if (!s || s.v !== 1 || !s.macro) { ctx.s = freshGround(); return ctx.s; }
  if (!s.totals) s.totals = { cutM3: 0, fillM3: 0 };
  if (!s.pending) s.pending = [];
  return s;
}

export const groundSystem = ({ fineOf = defaultFineOf, tampBits = [4, 8] } = {}) => {
  fineOfRead = fineOf;
  const fineFor = (ctx) => fineOf(ctx.get);
  // after a macro change: tell the host, and make whoever draws fine ground on top of it redraw
  function changed(ctx, keys) {
    if (!keys || !keys.length) return;
    const s = ctx.s;
    s.rev++;
    const fine = fineFor(ctx);
    if (fine) {
      const span = s.macro.step * s.macro.T, m = s.macro.step, fspan = fine.step * fine.T;
      const boxes = keys.map((k) => { const [a, b] = k.split(',').map(Number); return [a * span - m, b * span - m, (a + 1) * span + m, (b + 1) * span + m]; });
      for (const k in fine.tiles) {
        const [tx, tz] = k.split(',').map(Number), x = tx * fspan, z = tz * fspan;
        if (boxes.some((b) => x < b[2] && x + fspan > b[0] && z < b[3] && z + fspan > b[1])) { fine.rev++; break; }
      }
    }
    ctx.emit('ground.macro', { keys });
  }
  return {
    name: 'ground',
    every: 1,
    init: () => freshGround(),
    // only settles what a push left over-steep; returns at once when nothing is waiting
    step(ctx) {
      const s = ctx.s;
      if (!s || !s.pending || !s.pending.length) return;
      const fine = fineFor(ctx), keys = new Set();
      for (const [x, z, r, on] of s.pending) {
        if (on === 'fine' && fine) EW.settle(fine, x, z, r);
        else { EW.settle(s.macro, x, z, r); for (const k of GC.keysIn(s.macro, x - r - 1, z - r - 1, x + r + 1, z + r + 1)) keys.add(k); }
      }
      s.pending = [];
      changed(ctx, [...keys]);
    },
    commands: {
      'ground.cut'(ctx, p = {}) {
        if (!num(p.x) || !num(p.z)) return fail('no place');
        if (!(num(p.m3) && p.m3 > 0)) return fail('nothing to take');
        if (!(num(p.r) && p.r > 0 && p.r < 50)) return fail('bad footprint');
        const s = ensure(ctx), res = GC.cut(s, fineFor(ctx), p.x, p.z, p.m3, { r: p.r, maxDepth: num(p.maxDepth) ? p.maxDepth : undefined, bare: typeof p.bare === 'string' ? p.bare : 'soil', t: hours(ctx), on: p.on });
        s.totals.cutM3 += res.m3;
        changed(ctx, res.keys);
        return { ok: true, m3: res.m3, s: res.s, on: res.on };
      },
      'ground.fill'(ctx, p = {}) {
        if (!num(p.x) || !num(p.z)) return fail('no place');
        if (!(num(p.m3) && p.m3 > 0)) return fail('nothing to put');
        if (!(num(p.r) && p.r > 0 && p.r < 50)) return fail('bad footprint');
        const s = ensure(ctx), res = GC.fill(s, fineFor(ctx), p.x, p.z, p.m3, { r: p.r, surface: typeof p.surface === 'string' ? p.surface : 'soil', layer: !!p.layer, t: hours(ctx), on: p.on });
        s.totals.fillM3 += res.m3;
        changed(ctx, res.keys);
        return { ok: true, m3: res.m3, on: res.on };
      },
      'ground.push'(ctx, p = {}) {
        if (![p.x0, p.z0, p.x1, p.z1].every(num)) return fail('no path');
        if (!(num(p.w) && p.w > 0 && p.w < 20)) return fail('bad blade');
        if (!num(p.level) && !num(p.levelY)) return fail('no level');
        if (Math.hypot(p.x1 - p.x0, p.z1 - p.z0) > 50) return fail('too far in one push');
        const s = ensure(ctx), world = num(p.levelY);
        const res = GC.push(s, fineFor(ctx), p.x0, p.z0, p.x1, p.z1, world ? p.levelY : p.level, { w: p.w, t: hours(ctx), levelIsWorldY: world, base, on: p.on });
        s.pending.push(res.settle);
        changed(ctx, res.keys);
        return { ok: true, m3: res.m3, s: res.s, on: res.on };
      },
      'ground.grade'(ctx, p = {}) {
        if (!Array.isArray(p.samples) || !p.samples.length || p.samples.length > 4096 || !p.samples.every(okPt)) return fail('no samples');
        if (!num(p.targetY)) return fail('no level');
        if (!(num(p.core) && num(p.rim) && p.core >= 0 && p.rim > p.core && p.rim < 50)) return fail('bad rim');
        const s = ensure(ctx), res = GC.gradePad(s, fineFor(ctx), base, p.samples, p.targetY, { core: p.core, rim: p.rim, pit: !!p.pit, absorb: p.absorb !== false, t: hours(ctx) });
        s.totals.cutM3 += res.cutM3; s.totals.fillM3 += res.fillM3;
        changed(ctx, res.keys);
        return { ok: true, cutM3: res.cutM3, fillM3: res.fillM3, tiles: res.keys };
      },
      'ground.trim'(ctx, p = {}) {
        if (!GC.validRegion(p.region)) return fail('bad region');
        if (!num(p.targetY)) return fail('no level');
        const s = ensure(ctx), res = GC.trimTo(s, fineFor(ctx), base, p.region, p.targetY, { bare: typeof p.bare === 'string' ? p.bare : 'soil', t: hours(ctx) });
        s.totals.cutM3 += res.m3;
        changed(ctx, res.keys);
        return { ok: true, m3: res.m3 };
      },
      'ground.tamp'(ctx, p = {}) {
        if (!num(p.x) || !num(p.z)) return fail('no place');
        if (!(num(p.r) && p.r > 0 && p.r < 50)) return fail('bad footprint');
        const s = ensure(ctx), res = GC.tamp(s, fineFor(ctx), p.x, p.z, p.r, num(p.passes) ? p.passes : 1, tampBits, { on: p.on });
        changed(ctx, res.keys);
        return { ok: true, n: res.n, on: res.on };
      },
      // bridge for the host's own terrain writers (a brush): one macro tile's heights, Float32 metres as base64
      'ground.importMacro'(ctx, p = {}) {
        if (typeof p.key !== 'string' || !KEY.test(p.key) || typeof p.b64 !== 'string') return fail('bad tile');
        const s = ensure(ctx);
        let m;
        try { m = base64ToF32(p.b64); } catch (e) { return fail('bad tile'); }
        if (m.length !== s.macro.T * s.macro.T) return fail('bad tile');
        if (GC.importTile(s, p.key, m)) changed(ctx, [p.key]);
        return { ok: true };
      },
    },
  };
};

// Reads for views and tools (any state, no ctx).
const G = (state) => (state.sys && state.sys.ground && state.sys.ground.macro ? state.sys.ground : GC.makeGround());
const fineR = (state) => fineOfRead((n) => state.sys[n]);
export const groundRead = {
  // the walked surface: base + macro + fine (no built floors)
  surfaceY: (state, x, z) => GC.surfaceY(G(state), fineR(state), base, x, z),
  // base + macro: what the terrain mesh draws
  gradedY: (state, x, z) => GC.gradedY(G(state), base, x, z),
  relief: (state, x, z) => GC.reliefTotal(G(state), fineR(state), x, z),
  conform: (state, region, targetY, tolUp, tolDown, cellM) => GC.conform(G(state), fineR(state), base, region, targetY, tolUp, tolDown, cellM),
  macroTile: (state, key, out) => GC.tileMetres(G(state), key, out),
  macroKeys: (state) => Object.keys(G(state).macro.tiles),
  netVolume: (state) => GC.netVolume(G(state), fineR(state)),
  totals: (state) => ({ ...(G(state).totals || { cutM3: 0, fillM3: 0 }) }),
};
