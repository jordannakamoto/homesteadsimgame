// Vehicles, generic (no game words): the world truth about each unit and the drive model it moves by.
// createVehicleSystem keeps where each unit is parked, its fuel, who sits where, what is hitched and attached, and
// rentals. It is changed only by commands; the sim never integrates driving (a tick is 60 world seconds). The page
// steps the drive model (vehicles-drive.js, re-exported here) at a fixed real-time step and reports the pose with
// `<name>.sync` twice a second and on stepping off, like the wheelbarrow's barrowMove.
//
// State, at sim.state.sys[name]:
//   { nextId, starter, units: { [id]: unit }, totals: { fuelAddedL, fuelBurnedL, fuelGoneL, distM } }
//   unit = { id, kind, x, z, yaw, fuelL, odoM, engineS, seats: { [seatId]: actor | null },
//            towing: id | null, towedBy: id | null, artic (towed unit only: its yaw minus its tow unit's, rad),
//            impl: { [pointId]: { kind, q: [], state: {} } }, owner: 'own' | 'rent', rentUntil: t | null }
// Fuel is conserved: fuelAddedL = sum of fuelL + fuelBurnedL + fuelGoneL (fuel that left with a removed unit).
//
// hooks (content): takeFuel(ctx, litres) -> litres actually taken (pays from stock; default: free),
//                  pay(ctx, usd) -> bool (rentals; default: refuses)
// kinds: the vehicle records (see vehicles-drive.js); a kind with rentUsdPerDay can be rented.

import { hitchPose, towPoint, wrap, ARTIC_MAX } from './vehicles-drive.js';
export * from './vehicles-drive.js';

const round6 = (x) => Math.round(x * 1e6) / 1e6;
const cents = (x) => Math.round(x * 100) / 100;
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const DAY = 86400;
export const HITCH_REACH_M = 0.6;      // the ball must be this close to the tongue (the page latches at 0.4)

export function initVehicles() {
  return { nextId: 1, starter: false, units: {}, totals: { fuelAddedL: 0, fuelBurnedL: 0, fuelGoneL: 0, distM: 0 } };
}
// fuelAddedL - (in tanks + burned + gone): zero when the books balance
export function fuelImbalance(s) {
  let inTanks = 0;
  for (const u of Object.values(s.units)) inTanks += u.fuelL;
  const t = s.totals;
  return round6(t.fuelAddedL - inTanks - t.fuelBurnedL - t.fuelGoneL);
}
export const seated = (u) => Object.values(u.seats).some((a) => a != null);
export function seatOf(s, actor) {
  for (const u of Object.values(s.units)) for (const [seat, a] of Object.entries(u.seats)) if (a === actor) return { id: u.id, seat };
  return null;
}

export function createVehicleSystem({ name = 'vehicles', kinds, implementKinds = {}, hooks = {} } = {}) {
  if (!kinds) throw new Error('createVehicleSystem needs kinds');
  const takeFuel = hooks.takeFuel || ((ctx, l) => l);
  const pay = hooks.pay || (() => false);
  const bad = (reason) => ({ ok: false, reason });
  const unitOf = (s, id) => s.units[id] || null;

  function addUnit(ctx, p) {
    const s = ctx.s, k = kinds[p && p.kind];
    if (!k) return bad('unknown kind');
    if (!fin(p.x) || !fin(p.z)) return bad('bad place');
    if (p.starter && s.starter) return bad('already given');
    const tank = k.fuel ? k.fuel.tankL : 0;
    const fuelL = round6(Math.max(0, Math.min(tank, fin(p.fuelL) ? p.fuelL : tank)));
    const id = 'v' + s.nextId++;
    s.units[id] = {
      id, kind: k.id, x: round6(p.x), z: round6(p.z), yaw: round6(wrap(fin(p.yaw) ? p.yaw : 0)),
      fuelL, odoM: 0, engineS: 0,
      seats: Object.fromEntries((k.seats || []).map((q) => [q.id, null])),
      towing: null, towedBy: null, artic: 0, impl: {},
      owner: p.owner === 'rent' ? 'rent' : 'own', rentUntil: p.owner === 'rent' && fin(p.rentUntil) ? round6(p.rentUntil) : null,
    };
    s.totals.fuelAddedL = round6(s.totals.fuelAddedL + fuelL);
    if (p.starter) s.starter = true;
    ctx.emit(name + '.added', { id, kind: k.id });
    return { ok: true, id };
  }
  function dropHitch(s, u) {
    if (u.towing && s.units[u.towing]) { s.units[u.towing].towedBy = null; s.units[u.towing].artic = 0; }
    if (u.towedBy && s.units[u.towedBy]) s.units[u.towedBy].towing = null;
    u.towing = null; u.towedBy = null; u.artic = 0;
  }
  function removeUnit(ctx, s, u, why) {
    dropHitch(s, u);
    s.totals.fuelGoneL = round6(s.totals.fuelGoneL + u.fuelL);
    delete s.units[u.id];
    ctx.emit(name + '.removed', { id: u.id, kind: u.kind, why });
  }
  // a towed unit follows its tow unit's pose (kept in the sim so a parked pair stays together)
  function placeTowed(s, u) {
    const t = u.towing && s.units[u.towing];
    if (!t) return;
    const pose = hitchPose(u, kinds[u.kind], kinds[t.kind], t.artic);
    t.x = round6(pose.x); t.z = round6(pose.z); t.yaw = round6(pose.yaw);
  }

  const commands = {
    [name + '.add']: addUnit,
    [name + '.remove']: (ctx, p) => {
      const u = unitOf(ctx.s, p && p.id);
      if (!u) return bad('no such unit');
      if (seated(u)) return bad('occupied');
      removeUnit(ctx, ctx.s, u, 'removed');
      return { ok: true };
    },
    [name + '.sit']: (ctx, p) => {
      const s = ctx.s, u = unitOf(s, p && p.id);
      if (!u) return bad('no such unit');
      const k = kinds[u.kind], actor = (p && p.actor) || 'player';
      if (!k.seats || !k.seats.length) return bad('no seat');
      const seat = (p && p.seat) || k.seats[0].id;
      if (!(seat in u.seats)) return bad('no such seat');
      if (u.seats[seat] != null) return bad('seat taken');
      if (seatOf(s, actor)) return bad('already seated');
      if (u.owner === 'rent' && u.rentUntil != null && ctx.state.t >= u.rentUntil) return bad('rental over');
      u.seats[seat] = actor;
      ctx.emit(name + '.sit', { id: u.id, seat, actor });
      return { ok: true, seat };
    },
    [name + '.leave']: (ctx, p) => {
      const u = unitOf(ctx.s, p && p.id);
      if (!u) return bad('no such unit');
      const seat = (p && p.seat) || Object.keys(u.seats).find((q) => u.seats[q] != null);
      if (!seat || u.seats[seat] == null) return bad('seat empty');
      const actor = u.seats[seat];
      u.seats[seat] = null;
      ctx.emit(name + '.leave', { id: u.id, seat, actor });
      return { ok: true };
    },
    // the page's report of where a driven unit got to and what it used
    [name + '.sync']: (ctx, p) => {
      const s = ctx.s, u = unitOf(s, p && p.id);
      if (!u) return bad('no such unit');
      if (!seated(u)) return bad('nobody driving');
      if (fin(p.x) && fin(p.z)) { u.x = round6(p.x); u.z = round6(p.z); }
      if (fin(p.yaw)) u.yaw = round6(wrap(p.yaw));
      const burned = round6(Math.max(0, Math.min(u.fuelL, fin(p.burnedL) ? p.burnedL : 0)));
      u.fuelL = round6(u.fuelL - burned);
      s.totals.fuelBurnedL = round6(s.totals.fuelBurnedL + burned);
      const dist = fin(p.distM) ? Math.max(0, Math.min(1e4, p.distM)) : 0;
      u.odoM = round6(u.odoM + dist); s.totals.distM = round6(s.totals.distM + dist);
      if (fin(p.engineS)) u.engineS = round6(u.engineS + Math.max(0, p.engineS));
      const t = u.towing && s.units[u.towing];
      if (t && fin(p.artic)) t.artic = round6(Math.max(-ARTIC_MAX, Math.min(ARTIC_MAX, wrap(p.artic))));
      placeTowed(s, u);
      return { ok: true, fuelL: u.fuelL, burnedL: burned };
    },
    // hitch two units: whichever has a `hitch` is towed by the other, on the other's point of that type
    [name + '.hitch']: (ctx, p) => {
      const s = ctx.s, a = unitOf(s, p && p.id), b = unitOf(s, p && p.to);
      if (!a || !b) return bad('no such unit');
      if (a === b) return bad('same unit');
      const ka = kinds[a.kind], kb = kinds[b.kind];
      const [tow, towed, kTow, kTowed] = kb.hitch ? [a, b, ka, kb] : ka.hitch ? [b, a, kb, ka] : [];
      if (!tow) return bad('nothing to hitch');
      if (kTow.drive === 'towed') return bad('cannot tow');
      const ball = towPoint(tow, kTow, kTowed.hitch.type);
      if (!ball) return bad('no ' + kTowed.hitch.type + ' to hitch to');
      if (Object.keys(tow.impl).some((q) => kTow.points.find((r) => r.id === q).type === kTowed.hitch.type)) return bad('point taken');
      if (tow.towing) return bad('already towing');
      if (towed.towedBy) return bad('already hitched');
      if (towed.towing || tow.towedBy) return bad('one at a time');
      const tongue = { x: towed.x + Math.sin(towed.yaw) * kTowed.hitch.at[2], z: towed.z + Math.cos(towed.yaw) * kTowed.hitch.at[2] };
      if (Math.hypot(ball.x - tongue.x, ball.z - tongue.z) > HITCH_REACH_M) return bad('too far');
      tow.towing = towed.id; towed.towedBy = tow.id;
      towed.artic = round6(Math.max(-ARTIC_MAX, Math.min(ARTIC_MAX, wrap(towed.yaw - tow.yaw))));
      placeTowed(s, tow);
      ctx.emit(name + '.hitch', { id: tow.id, towing: towed.id });
      return { ok: true, tow: tow.id, towed: towed.id };
    },
    [name + '.unhitch']: (ctx, p) => {
      const s = ctx.s, u = unitOf(s, p && p.id);
      if (!u) return bad('no such unit');
      if (!u.towing && !u.towedBy) return bad('not hitched');
      const pair = { id: u.towedBy || u.id, towed: u.towing || u.id };
      dropHitch(s, u);
      ctx.emit(name + '.unhitch', pair);
      return { ok: true };
    },
    [name + '.attach']: (ctx, p) => {
      const u = unitOf(ctx.s, p && p.id);
      if (!u) return bad('no such unit');
      const ik = implementKinds[p.kind];
      if (!ik) return bad('unknown implement');
      const pt = (kinds[u.kind].points || []).find((q) => q.id === p.point);
      if (!pt) return bad('no such point');
      if (pt.type !== ik.mounts) return bad('does not fit');
      if (u.impl[pt.id]) return bad('point taken');
      if (u.towing && pt.type === kinds[ctx.s.units[u.towing].kind].hitch.type) return bad('point taken');   // a trailer is on it
      u.impl[pt.id] = { kind: ik.id, q: (ik.joints || []).map((j) => round6(Math.max(j.min, Math.min(j.max, 0)))), state: {} };
      return { ok: true };
    },
    [name + '.detach']: (ctx, p) => {
      const u = unitOf(ctx.s, p && p.id);
      if (!u) return bad('no such unit');
      if (!u.impl[p.point]) return bad('nothing there');
      delete u.impl[p.point];
      return { ok: true };
    },
    [name + '.setJoints']: (ctx, p) => {
      const u = unitOf(ctx.s, p && p.id), im = u && u.impl[p.point];
      if (!im) return bad('nothing there');
      const joints = implementKinds[im.kind].joints || [];
      if (!Array.isArray(p.q) || p.q.length !== joints.length || !p.q.every(fin)) return bad('bad joints');
      im.q = p.q.map((v, i) => round6(Math.max(joints[i].min, Math.min(joints[i].max, v))));
      return { ok: true, q: im.q };
    },
    [name + '.refuel']: (ctx, p) => {
      const s = ctx.s, u = unitOf(s, p && p.id);
      if (!u) return bad('no such unit');
      const k = kinds[u.kind];
      if (!k.fuel) return bad('takes no fuel');
      const room = round6(k.fuel.tankL - u.fuelL);
      if (!(room > 1e-6)) return bad('full');
      const want = Math.min(room, fin(p.litres) && p.litres > 0 ? p.litres : room);
      const got = round6(Math.max(0, Math.min(want, +takeFuel(ctx, want, k.fuel.item) || 0)));
      if (!(got > 0)) return bad('no fuel');
      u.fuelL = round6(u.fuelL + got);
      s.totals.fuelAddedL = round6(s.totals.fuelAddedL + got);
      ctx.emit(name + '.refuel', { id: u.id, litres: got });
      return { ok: true, litres: got, fuelL: u.fuelL };
    },
    // rent a unit by the day (or more days on one you rent: { id, days }); it is collected when the time is up
    [name + '.rent']: (ctx, p) => {
      const s = ctx.s, days = Math.max(1, Math.min(14, Math.round((p && p.days) || 1)));
      if (p && p.id) {
        const u = unitOf(s, p.id);
        if (!u || u.owner !== 'rent') return bad('not a rental');
        const usd = cents(kinds[u.kind].rentUsdPerDay * days);
        if (!pay(ctx, usd)) return { ok: false, reason: 'not enough money', costUsd: usd };
        u.rentUntil = round6(Math.max(u.rentUntil, ctx.state.t) + days * DAY);
        return { ok: true, id: u.id, costUsd: usd, until: u.rentUntil };
      }
      const k = kinds[p && p.kind];
      if (!k) return bad('unknown kind');
      if (!(k.rentUsdPerDay > 0)) return bad('not for rent');
      if (!fin(p.x) || !fin(p.z)) return bad('bad place');
      const usd = cents(k.rentUsdPerDay * days);
      if (!pay(ctx, usd)) return { ok: false, reason: 'not enough money', costUsd: usd };
      const r = addUnit(ctx, { kind: k.id, x: p.x, z: p.z, yaw: p.yaw, owner: 'rent', rentUntil: ctx.state.t + days * DAY });
      return { ...r, costUsd: usd, until: s.units[r.id].rentUntil };
    },
  };

  return {
    name,
    every: 60,          // an hour: the step only ends rentals; everything else is a command
    init: () => initVehicles(),
    step(ctx) {
      const s = ctx.s;
      for (const u of Object.values(s.units)) {
        if (u.owner !== 'rent' || u.rentUntil == null || ctx.state.t < u.rentUntil) continue;
        if (seated(u)) continue;                     // collected once nobody is on it
        removeUnit(ctx, s, u, 'returned');
      }
    },
    commands,
    api: { kinds, implementKinds, fuelImbalance, seatOf, seated, hitchPose },
  };
}
