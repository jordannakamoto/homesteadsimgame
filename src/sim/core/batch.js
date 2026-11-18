// Batch: something mixed in a vessel (a drum, a tub, a barrow). Generic: it knows parts by name and volume, how
// thoroughly they have been worked together, and a ratio between two parts read against bands the caller gives; it
// knows nothing of concrete. Mortar, plaster, feed or compost tea use it the same way.
//
// batch = { cap, parts: { [id]: qty }, vol, mixed, t0 }
//   cap: m3 the vessel holds; vol: m3 of what is in it (parts that take room); mixed: 0..1 how evenly it is worked
//   through; t0: when the first part that starts the clock went in (the caller's clock, e.g. first water), or null.
// Every function is pure on plain JSON and changes nothing when it refuses.

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function newBatch({ capM3 = 0.05 } = {}) { return { cap: capM3, parts: {}, vol: 0, mixed: 0, t0: null }; }
export const isEmpty = (b) => !b || !(b.vol > 1e-9) && !Object.values(b.parts).some((q) => q > 1e-9);
export const room = (b) => Math.max(0, b.cap - b.vol);

// Add qty of a part. m3Each: the room one unit takes (0 for parts that fill the gaps, like water in a dry mix).
// Only as much as fits goes in; returns what went in. A fresh part dilutes how mixed the batch is.
// `clock`: the time to start t0 from, when this part starts it (first water).
export function add(b, id, qty, { m3Each = 0, clock = null } = {}) {
  if (!(qty > 0)) return 0;
  let q = qty;
  if (m3Each > 0) q = Math.min(q, Math.floor((room(b) / m3Each) * 1e6 + 1e-6) / 1e6);
  if (!(q > 1e-9)) return 0;
  const before = b.vol, dv = m3Each * q;
  b.parts[id] = r6((b.parts[id] || 0) + q);
  b.vol = r6(b.vol + dv);
  if (dv > 0 && b.vol > 0) b.mixed = r6((b.mixed * before) / b.vol);   // new dry stuff is not yet worked in
  if (clock !== null && b.t0 === null) b.t0 = clock;
  return q;
}
// Work the batch through: `amount` of work (strokes of a hoe in metres, drum turns...) against `perM3` work it takes
// to mix one cubic metre evenly. Returns how mixed it is now.
export function work(b, amount, perM3) {
  if (!(amount > 0) || !(b.vol > 1e-9)) return b.mixed;
  b.mixed = r6(clamp01(b.mixed + amount / Math.max(1e-9, perM3 * b.vol)));
  return b.mixed;
}
// A machine turning it for dt seconds at `rate` work a second (the drum's work function).
export const stepBatch = (b, dt, rate, perM3) => work(b, dt * rate, perM3);
// The ratio of two parts (by their own units), or null when the second is absent.
export function ratio(b, num, den, k = 1) { const d = (b.parts[den] || 0) * k; return d > 1e-12 ? (b.parts[num] || 0) / d : null; }
// The band a ratio falls in: bands = [{ id, upTo, ... }] in rising order (the last one's upTo may be Infinity).
// Returns { ratio, band, index } (band null with no ratio).
export function quality(b, { num, den, k = 1, bands }) {
  const r = ratio(b, num, den, k);
  if (r === null) return { ratio: null, band: null, index: -1 };
  let i = bands.findIndex((x) => r < x.upTo);
  if (i < 0) i = bands.length - 1;
  return { ratio: r6(r), band: bands[i], index: i };
}
// Take m3 out (tipped, poured, scooped): every part in proportion. Returns { m3, parts, mixed, t0 }; the batch keeps
// the rest (and is emptied of everything once its volume is gone).
export function discharge(b, m3) {
  const take = Math.min(Math.max(0, m3), b.vol);
  if (!(take > 1e-9)) return { m3: 0, parts: {}, mixed: b.mixed, t0: b.t0 };
  const f = take / b.vol, parts = {};
  for (const id in b.parts) {
    const q = f >= 1 - 1e-9 ? b.parts[id] : r6(b.parts[id] * f);
    parts[id] = q;
    b.parts[id] = r6(b.parts[id] - q);
    if (b.parts[id] <= 1e-9) delete b.parts[id];
  }
  const out = { m3: r6(take), parts, mixed: b.mixed, t0: b.t0 };
  b.vol = r6(b.vol - take);
  if (b.vol <= 1e-9) { b.vol = 0; b.parts = {}; b.mixed = 0; b.t0 = null; }
  return out;
}
// Pour one batch into another (a drum tipped into a barrow): as much as the receiver has room for.
export function transfer(from, to, m3 = Infinity) {
  const q = Math.min(m3, from.vol, room(to));
  if (!(q > 1e-9)) return 0;
  const before = to.vol, mixedFrom = from.mixed, t0 = from.t0, d = discharge(from, q);
  for (const id in d.parts) to.parts[id] = r6((to.parts[id] || 0) + d.parts[id]);
  to.vol = r6(to.vol + d.m3);
  to.mixed = r6((to.mixed * before + mixedFrom * d.m3) / to.vol);
  if (t0 !== null && (to.t0 === null || t0 < to.t0)) to.t0 = t0;
  return d.m3;
}
