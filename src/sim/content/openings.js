// Doors and windows as data: types, operation, standard sizes, default sill and head, frame look, price, mass.
// Pure data and arithmetic: no DOM, no three.js. Sizes are unit sizes (the sash and its frame) in metres;
// the rough opening is the unit plus a small gap. See docs/FRAMING.md.

export const ROUGH_GAP = 0.012;          // each side and the head: room to shim the unit plumb
export const FLOOR_GAP = 0.02;           // a door's rough opening sits just above the subfloor

// how a unit works: what the hands do to it in play
export const OPERATION = Object.freeze({
  fixed: 'does not open', swing: 'swings on hinges', slide: 'slides sideways', tilt_in: 'tilts in from the top',
  awning: 'tilts out from the bottom', double_hung: 'sashes slide up and down', fold: 'folds in panels', roll: 'rolls up overhead',
  casement: 'swings out on side hinges', dutch: 'top and bottom open separately', pocket: 'slides into the wall', barn: 'slides on a track outside',
});

// sill presets for windows, metres above the floor
export const SILL_PRESETS = Object.freeze({ standard: 0.9, counter: 1.07, low: 0.45, high: 1.5 });

// w, h: standard widths and heights. sill/head: default heights above the floor (doors: sill 0).
// look: panels across, grid (muntins across x down), track (a rail is visible), arch (round top).
const T = (id, name, kind, op, w, h, sill, extra) => ({
  id, name, kind, op, w, h, sill, store: kind === 'door' ? 'doors' : 'windows',
  look: { panels: 1, grid: [1, 1], track: false, arch: false, ...(extra.look || {}) },
  mass: extra.mass, price: extra.price, frame: extra.frame || 'wall', ...(extra.more || {}),
});

export const OPENING_TYPES = Object.freeze([
  // ---- windows
  T('picture', 'Picture window', 'window', 'fixed', [0.9, 1.2, 1.8], [1.0, 1.2, 1.5], 0.75, { mass: 24, price: 260, look: {} }),
  T('double_hung', 'Double-hung window', 'window', 'double_hung', [0.6, 0.9, 1.2], [1.2, 1.5], 0.85, { mass: 14, price: 210, look: { panels: 2, grid: [2, 3] } }),
  T('slider', 'Sliding window', 'window', 'slide', [0.9, 1.2, 1.5, 1.8], [0.6, 0.9, 1.2], 1.0, { mass: 16, price: 190, look: { panels: 2, track: true } }),
  T('casement', 'Casement window', 'window', 'casement', [0.6, 0.9, 1.2], [0.9, 1.2, 1.5], 0.9, { mass: 15, price: 240, look: { grid: [1, 2] } }),
  T('awning', 'Awning window', 'window', 'awning', [0.6, 0.9, 1.2, 1.8], [0.4, 0.6, 0.9], 1.2, { mass: 10, price: 170 }),
  T('transom', 'Transom window', 'window', 'fixed', [0.9, 1.2, 1.8, 2.4], [0.3, 0.4, 0.5], 2.1, { mass: 8, price: 110, look: { grid: [3, 1] }, more: { aboveDoor: true } }),
  T('arched', 'Round-top window', 'window', 'fixed', [0.6, 0.9, 1.2], [1.2, 1.5], 0.9, { mass: 22, price: 380, look: { arch: true, grid: [2, 2] } }),
  T('clerestory', 'Bathroom / clerestory window', 'window', 'tilt_in', [0.6, 0.9, 1.2], [0.3, 0.45], 1.7, { mass: 6, price: 90 }),
  // ---- doors
  T('door_single', 'Single door, pre-hung', 'door', 'swing', [0.76, 0.81, 0.915], [2.03, 2.13], 0, { mass: 38, price: 180, look: { grid: [1, 1] } }),
  T('door_french', 'Double / French door', 'door', 'swing', [1.22, 1.52, 1.83], [2.03, 2.13], 0, { mass: 70, price: 520, look: { panels: 2, grid: [3, 5] } }),
  T('door_patio', 'Sliding patio door', 'door', 'slide', [1.83, 2.44, 3.05], [2.03, 2.13], 0, { mass: 95, price: 780, look: { panels: 2, track: true } }),
  T('door_dutch', 'Dutch door', 'door', 'dutch', [0.81, 0.915], [2.03], 0, { mass: 42, price: 340, look: { panels: 2 } }),
  T('door_barn', 'Barn door on a track', 'door', 'barn', [0.915, 1.07, 1.22], [2.03, 2.13], 0, { mass: 55, price: 290, look: { track: true }, more: { surface: true, leafOver: 0.1 } }),
  T('door_pocket', 'Pocket door', 'door', 'pocket', [0.76, 0.81, 0.915], [2.03], 0, { mass: 36, price: 320, frame: 'pocket', more: { pocket: true } }),
  T('door_bifold', 'Bifold closet door', 'door', 'fold', [0.76, 0.91, 1.22, 1.52], [2.03], 0, { mass: 20, price: 140, look: { panels: 2 } }),
  T('door_garage', 'Roll-up garage door', 'door', 'roll', [2.44, 3.05, 4.88], [2.13, 2.44], 0, { mass: 120, price: 950, frame: 'beam', look: { grid: [1, 4], track: true } }),
]);

export const OPENING_BY_ID = Object.freeze(Object.fromEntries(OPENING_TYPES.map((t) => [t.id, t])));
export const openingType = (id) => OPENING_BY_ID[id] || null;

// The old fixed 1 m module shapes, mapped to the nearest type and size (so old saves keep their look).
export const LEGACY_OPEN = Object.freeze({
  door: ['door_single', 0.81, 2.03], door2: ['door_single', 0.915, 2.13], gate: ['door_single', 0.81, 2.13], railgate: ['door_single', 0.76, 1.1],
  window: ['double_hung', 0.9, 1.5], window2: ['arched', 0.6, 1.5], window3: ['clerestory', 0.3, 1.2], window4: ['casement', 0.6, 1.2],
  arch: ['door_single', 0.81, 2.13], arch2: ['door_single', 0.81, 2.13], arch3: ['door_single', 0.81, 2.13],
});
export const mapLegacy = (old) => { const m = LEGACY_OPEN[old]; return m ? { type: m[0], w: m[1], h: m[2] } : null; };

// the rough opening for a unit of size (w, h) at sill height `sill`
export function roughOpening(type, w, h, sill) {
  const t = typeof type === 'string' ? OPENING_BY_ID[type] : type;
  const sl = t.kind === 'door' ? FLOOR_GAP : (sill === undefined ? t.sill : sill) - ROUGH_GAP;
  return { width: w + 2 * ROUGH_GAP, height: h + (t.kind === 'door' ? ROUGH_GAP + FLOOR_GAP : 2 * ROUGH_GAP), sill: sl };
}

// ---- the header table: the smallest header that carries the span. Plies are boards side by side (doubled).
export const HEADER_TABLE = Object.freeze([
  { upTo: 1.2, size: '2x6', plies: 2 },
  { upTo: 1.8, size: '2x8', plies: 2 },
  { upTo: 2.4, size: '2x10', plies: 2 },
  { upTo: 3.0, size: '2x12', plies: 2 },
]);
// Beyond 3 m: an engineered beam (glulam) and doubled jack studs.
export function headerSpec(span) {
  for (const r of HEADER_TABLE) if (span <= r.upTo + 1e-9) return { size: r.size, plies: r.plies, jacks: 1, engineered: false };
  return { size: 'glulam', plies: 1, jacks: 2, engineered: true };
}

// ---- a catalog unit as a store item: one item per type and size, sold each. Ids: op_<type>_<w mm>x<h mm>.
export const openingItemId = (type, w, h) => `op_${type}_${Math.round(w * 1000)}x${Math.round(h * 1000)}`;
export function openingItems() {
  const out = {};
  for (const t of OPENING_TYPES) {
    for (const w of t.w) for (const h of t.h) {
      const id = openingItemId(t.id, w, h), ref = t.w[0] * t.h[0], k = Math.sqrt((w * h) / (t.w[0] * t.h[0])) || 1;
      out[id] = { id, name: `${t.name} ${Math.round(w * 1000)} x ${Math.round(h * 1000)}`, category: 'glass', store: t.store, unit: 'each', massKgPerUnit: Math.round(t.mass * (w * h) / ref * 10) / 10 || t.mass, priceUsd: Math.round(t.price * k), dims: { lengthM: h, widthM: w, thicknessM: t.kind === 'door' ? 0.045 : 0.08 }, blurb: `${t.name}: ${OPERATION[t.op]}` };
    }
  }
  return out;
}
