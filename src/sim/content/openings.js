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
// look: panels across, grid (muntins across x down), track (a rail is visible), arch (round top), shape (the outline:
// rect, arch, half, round, gothic), lites ([across, down] separate panes between mullions), grille (the pattern of
// muntins, see GRILLES; left out means colonial when grid is more than one pane, else none), slim (a thin modern frame).
// finish: the frame colour (see FINISHES). range: the smallest and largest made-to-order sizes, { w: [a, b], h: [a, b] }.
const T = (id, name, kind, op, w, h, sill, extra) => ({
  id, name, kind, op, w, h, sill, store: kind === 'door' ? 'doors' : 'windows',
  look: { panels: 1, grid: [1, 1], track: false, arch: false, ...(extra.look || {}) },
  mass: extra.mass, price: extra.price, frame: extra.frame || 'wall', finish: extra.finish || (kind === 'door' ? 'wood' : 'white'),
  range: extra.range || { w: [Math.max(0.3, Math.min(...w) * 0.5), Math.max(...w) * 1.6], h: [Math.max(0.25, Math.min(...h) * 0.5), Math.min(kind === 'door' ? 2.45 : 2.45, Math.max(...h) * 1.4)] },
  blurb: extra.blurb || '', ...(extra.more || {}),
});
export const OPENING_TYPES = Object.freeze([
  // ---- windows: classic
  T('double_hung', 'Double-hung window', 'window', 'double_hung', [0.6, 0.9, 1.2], [1.2, 1.5], 0.85, { mass: 14, price: 210, look: { panels: 2, grid: [2, 3] }, blurb: 'The classic: two sashes, the lower one slides up. Colonial, farmhouse, craftsman.' }),
  T('casement', 'Casement window', 'window', 'casement', [0.6, 0.9, 1.2], [0.9, 1.2, 1.5], 0.9, { mass: 15, price: 240, look: { grid: [1, 2] }, blurb: 'Hinged at the side, swings out. Cottages, prairie and craftsman homes.' }),
  T('picture', 'Picture window', 'window', 'fixed', [0.9, 1.2, 1.8], [1.0, 1.2, 1.5], 0.75, { mass: 24, price: 260, look: {}, range: { w: [0.4, 3.6], h: [0.4, 2.4] }, blurb: 'One big fixed pane for the view.' }),
  T('slider', 'Sliding window', 'window', 'slide', [0.9, 1.2, 1.5, 1.8], [0.6, 0.9, 1.2], 1.0, { mass: 16, price: 190, look: { panels: 2, track: true }, blurb: 'Two sashes, one slides sideways. Ranch and mid-century.' }),
  T('awning', 'Awning window', 'window', 'awning', [0.6, 0.9, 1.2, 1.8], [0.4, 0.6, 0.9], 1.2, { mass: 10, price: 170, blurb: 'Hinged at the top, tilts out: open in the rain.' }),
  T('hopper', 'Hopper window', 'window', 'tilt_in', [0.6, 0.9, 1.2], [0.4, 0.6], 0.5, { mass: 9, price: 150, blurb: 'Hinged at the bottom, tips in. Cellars, baths, under a picture window.' }),
  T('arched', 'Round-top window', 'window', 'fixed', [0.6, 0.9, 1.2], [1.2, 1.5], 0.9, { mass: 22, price: 380, look: { arch: true, shape: 'arch', grid: [2, 2] }, blurb: 'A rectangle with a half-round top. Victorian, Italianate, farmhouse gables.' }),
  T('gothic', 'Gothic arch window', 'window', 'fixed', [0.6, 0.9, 1.2], [1.5, 1.8], 0.8, { mass: 22, price: 420, look: { shape: 'gothic', grille: 'diamond' }, blurb: 'A pointed arch. Gothic revival, chapels, storybook cottages.' }),
  T('half_round', 'Half-round fanlight', 'window', 'fixed', [0.6, 0.9, 1.2, 1.8], [0.3, 0.45, 0.6, 0.9], 2.0, { mass: 9, price: 260, look: { shape: 'half', grille: 'sunburst' }, range: { w: [0.4, 3.0], h: [0.2, 1.5] }, more: { aboveDoor: true }, blurb: 'A half-moon over a door or a window, with a sunburst grille.' }),
  T('round', 'Round window', 'window', 'fixed', [0.45, 0.6, 0.9], [0.45, 0.6, 0.9], 1.4, { mass: 8, price: 230, look: { shape: 'round', grid: [2, 2] }, range: { w: [0.3, 1.5], h: [0.3, 1.5] }, blurb: 'An oculus: gables, stair halls, a ship-shape bath.' }),
  T('transom', 'Transom window', 'window', 'fixed', [0.9, 1.2, 1.8, 2.4], [0.3, 0.4, 0.5], 2.1, { mass: 8, price: 110, look: { grid: [3, 1] }, more: { aboveDoor: true }, blurb: 'A short fixed strip over a door or a window.' }),
  T('clerestory', 'Bathroom / clerestory window', 'window', 'tilt_in', [0.6, 0.9, 1.2], [0.3, 0.45], 1.7, { mass: 6, price: 90, blurb: 'High and small: light without being seen.' }),
  // ---- windows: modern
  T('full_panel', 'Full-height glass panel', 'window', 'fixed', [0.6, 0.9, 1.2, 1.8], [2.1, 2.3, 2.4], 0.15, { mass: 40, price: 520, look: { slim: true }, finish: 'black', range: { w: [0.3, 3.0], h: [1.2, 2.45] }, blurb: 'Floor to ceiling fixed glass in a thin black frame.' }),
  T('window_wall', 'Glass window wall', 'window', 'fixed', [2.4, 3.0, 3.6, 4.8], [2.1, 2.3, 2.4], 0.15, { mass: 90, price: 1600, look: { slim: true, lites: [3, 1] }, finish: 'black', range: { w: [1.2, 6.0], h: [1.2, 2.45] }, blurb: 'A whole wall of glass panes between slim mullions.' }),
  T('slot', 'Vertical slot window', 'window', 'fixed', [0.3, 0.45, 0.6], [1.5, 1.8, 2.1, 2.3], 0.3, { mass: 14, price: 240, look: { slim: true }, finish: 'black', range: { w: [0.2, 0.9], h: [0.6, 2.45] }, blurb: 'Tall and narrow. Set several at different heights for a modern facade.' }),
  T('ribbon', 'Ribbon window', 'window', 'fixed', [1.8, 2.4, 3.6], [0.4, 0.6, 0.9], 1.2, { mass: 30, price: 680, look: { slim: true, lites: [3, 1] }, finish: 'black', range: { w: [1.0, 6.0], h: [0.25, 1.2] }, blurb: 'A long low band of glass, at eye level or up under the roof.' }),
  T('tilt_turn', 'Tilt-turn window', 'window', 'tilt_in', [0.6, 0.9, 1.2], [1.2, 1.5], 0.9, { mass: 18, price: 330, look: { slim: true }, finish: 'black', blurb: 'European: tips in at the top to air the room.' }),
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

// ---- the window designer: frame colours, grille patterns and the looks that set them together
// colours are sRGB hex; the page turns them into its own colour space
export const FINISHES = Object.freeze({
  white: { name: 'White', hex: 0xf1eee6 }, cream: { name: 'Cream', hex: 0xe3d7bb }, black: { name: 'Black', hex: 0x1d1f21 },
  bronze: { name: 'Dark bronze', hex: 0x3c2f25 }, wood: { name: 'Natural wood', hex: 0x9a6c43 }, sage: { name: 'Sage green', hex: 0x7c8a6c },
  green: { name: 'Hunter green', hex: 0x2f4a36 }, red: { name: 'Barn red', hex: 0x7c2a22 }, blue: { name: 'Slate blue', hex: 0x4a5b6e },
});
export const GRILLES = Object.freeze({
  none: 'No grille', colonial: 'Colonial grid', cottage: 'Cottage (top only)', farmhouse: 'Farmhouse 2 over 2', craftsman: 'Craftsman (upright top)',
  prairie: 'Prairie border', diamond: 'Diamond', sunburst: 'Sunburst',
});
export const SHAPES = Object.freeze({ rect: 'Rectangle', arch: 'Round top', gothic: 'Pointed arch', half: 'Half round', round: 'Round' });
// whole looks in one click: a grille, its grid, a frame colour and shutters
export const LOOKS = Object.freeze({
  colonial: { name: 'Colonial', grille: 'colonial', grid: [3, 4], finish: 'white', shutters: 'black' },
  cottage: { name: 'Cottage', grille: 'cottage', grid: [3, 2], finish: 'white', shutters: 'green' },
  farmhouse: { name: 'Modern farmhouse', grille: 'farmhouse', grid: [2, 2], finish: 'black', shutters: 'none' },
  craftsman: { name: 'Craftsman', grille: 'craftsman', grid: [3, 2], finish: 'wood', shutters: 'none' },
  prairie: { name: 'Prairie', grille: 'prairie', grid: [1, 1], finish: 'bronze', shutters: 'none' },
  tudor: { name: 'Tudor', grille: 'diamond', grid: [3, 4], finish: 'bronze', shutters: 'none' },
  modern: { name: 'Modern', grille: 'none', grid: [1, 1], finish: 'black', shutters: 'none' },
  plain: { name: 'Plain', grille: 'none', grid: [1, 1], finish: 'white', shutters: 'none' },
});
// the look a free opening ends up with: the type's defaults under the designer's choices (f.look, f.finish)
export function lookOf(t, f = {}) {
  const L = { shape: t.look.arch ? 'arch' : 'rect', lites: [1, 1], slim: false, shutters: 'none', ...t.look, ...(f.look || {}) };
  if (!L.grille) L.grille = L.grid[0] > 1 || L.grid[1] > 1 ? 'colonial' : 'none';
  return L;
}

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
// Standard sizes are in the store's list; any other size is made to order (a fifth dearer) and its item is made from
// its id the first time something asks for it (see openingItemFromId and src/sim/items.js).
export const openingItemId = (type, w, h) => `op_${type}_${Math.round(w * 1000)}x${Math.round(h * 1000)}`;
export function openingItem(t, w, h) {
  if (typeof t === 'string') t = OPENING_BY_ID[t];
  if (!t) return null;
  const id = openingItemId(t.id, w, h), ref = t.w[0] * t.h[0], k = Math.sqrt((w * h) / ref) || 1,
    std = t.w.some((x) => Math.abs(x - w) < 1e-6) && t.h.some((x) => Math.abs(x - h) < 1e-6);
  return { id, name: `${t.name} ${Math.round(w * 1000)} x ${Math.round(h * 1000)}${std ? '' : ' (made to order)'}`, category: t.store, store: t.store, unit: 'each', massKgPerUnit: Math.round(t.mass * (w * h) / ref * 10) / 10 || t.mass, priceUsd: Math.round(t.price * k * (std ? 1 : 1.2)), dims: { lengthM: h, widthM: w, thicknessM: t.kind === 'door' ? 0.045 : 0.08 }, blurb: `${t.name}: ${OPERATION[t.op]}`, madeToOrder: !std };
}
export function openingItems() {
  const out = {};
  for (const t of OPENING_TYPES) for (const w of t.w) for (const h of t.h) { const it = openingItem(t, w, h); out[it.id] = it; }
  return out;
}
// a made-to-order unit's item from its id, or null when the id is not a unit's
export function openingItemFromId(id) {
  const m = /^op_(.+)_(\d+)x(\d+)$/.exec(id || '');
  return m && OPENING_BY_ID[m[1]] ? openingItem(m[1], +m[2] / 1000, +m[3] / 1000) : null;
}

// ---- free openings: placed anywhere along a wall run, not tied to the 1 m modules (docs/FRAMING.md, phase 1).
// A free opening is saved as { id, typeId, sizeIdx, d, line, pos, sill, flip }: d and line say which grid wall line
// (d 0 runs along x), pos is where the unit's left edge is along that line in metres, sill the height above the floor
// (doors: 0), flip mirrors the swing or slide. Its offset along a run is pos - run.t0.
export const END_GAP = 0.1;              // a rough opening stays this far from a wall end
export const OPEN_GAP = 0.15;            // and this far from the next rough opening (a king and a jack stand between)
export const SNAP_DIST = 0.22;           // how close the pointer must be for a snap to take
export const SILL_NAMES = Object.freeze({ standard: 'Standard', counter: 'Kitchen counter', low: 'Low view', high: 'High privacy' });

export const openingSizes = (type) => { const t = typeof type === 'string' ? OPENING_BY_ID[type] : type, out = []; for (const w of t.w) for (const h of t.h) out.push({ w, h }); return out; };
export const sillFor = (type, preset) => { const t = typeof type === 'string' ? OPENING_BY_ID[type] : type; return t.kind === 'door' ? 0 : preset && SILL_PRESETS[preset] !== undefined ? SILL_PRESETS[preset] : t.sill; };

// a made-to-order size, kept inside the type's range and to the nearest 10 mm
export const fitSize = (t, w, h) => {
  if (typeof t === 'string') t = OPENING_BY_ID[t];
  const c = (v, r) => Math.round(Math.min(Math.max(v, r[0]), r[1]) * 100) / 100;
  return { w: c(w, t.range.w), h: c(h, t.range.h) };
};
// everything a free opening needs: the type, its size, the unit box, the rough opening, the header, and its look.
// f.w and f.h (a made-to-order size) win over f.sizeIdx; f.look and f.finish are the window designer's choices.
export function freeSpec(f) {
  const t = OPENING_BY_ID[f.typeId];
  if (!t) return null;
  let s;
  if (f.w > 0 && f.h > 0) s = fitSize(t, f.w, f.h);
  else { const sizes = openingSizes(t); s = sizes[Math.min(Math.max(0, f.sizeIdx | 0), sizes.length - 1)]; }
  const sill = t.kind === 'door' ? 0 : (f.sill === undefined ? t.sill : f.sill);
  const rough = roughOpening(t, s.w, s.h, sill);
  return { type: t, w: s.w, h: s.h, sill, head: sill + s.h, rough, header: headerSpec(rough.width), itemId: openingItemId(t.id, s.w, s.h), finish: f.finish || t.finish, look: lookOf(t, f) };
}
// the opening as the framing wants it: offset is along the run, the rough opening is wider than the unit
export function freeToFraming(f, offset) {
  const sp = freeSpec(f);
  return { id: f.id, kind: sp.type.kind, type: f.typeId, offset: offset - ROUGH_GAP, width: sp.rough.width, sill: sp.rough.sill, height: sp.rough.height, frame: sp.type.frame === 'wall' ? undefined : sp.type.frame, free: true };
}

// Where a new opening of unit width w and height h goes, given the pointer's position along the run (centre `at`).
// L: run length. others: [{ a, b, sill, head }] the rough extents of what is there (a < b along the run).
// Returns { offset (unit left edge), centre, sill, snap (a short name or ''), guides: [{ x }|{ y }], ok, reason }.
export function snapFree({ L, at, w, h, sill, others = [], windowsOnly = true, snap = true, wantSill = true }) {
  const rw = w + 2 * ROUGH_GAP, os = others.slice().sort((p, q) => p.a - q.a), guides = [];
  let c = at, name = '';
  if (snap) {
    const cand = [[L / 2, 'Wall centre']];
    for (let i = 0; i + 1 < os.length; i++) { const g0 = os[i].b, g1 = os[i + 1].a; g1 - g0 > rw && cand.push([(g0 + g1) / 2, 'Centre between']); }
    if (os.length) {
      const f = os[0], l = os[os.length - 1];
      if (f.a > END_GAP) cand.push([(END_GAP + f.a) / 2, 'Centre between']);
      if (L - l.b > END_GAP) cand.push([(l.b + L - END_GAP) / 2, 'Centre between']);
    }
    if (os.length >= 2) {
      const m = os.map((q) => (q.a + q.b) / 2), s = m[m.length - 1] - m[m.length - 2], s0 = m[1] - m[0];
      cand.push([m[m.length - 1] + s, 'Equal spacing'], [m[0] - s0, 'Equal spacing']);
    }
    let best = SNAP_DIST;
    for (const [x, nm] of cand) if (Math.abs(x - at) < best) { best = Math.abs(x - at); c = x; name = nm; }
    if (name) guides.push({ x: c });
  }
  // heads in line with the others (windows only: a door's head is its own)
  let sl = sill, headLine = false;
  if (snap && wantSill && sill > 0) {
    let best = 0.12;
    for (const q of os) if (q.sill > 0.1 && Math.abs(q.head - (sill + h)) < best) { best = Math.abs(q.head - (sill + h)); sl = q.head - h; guides.push({ y: q.head }); headLine = true; }
  }
  const offset = c - w / 2;
  let ok = true, reason = '';
  const a = offset - ROUGH_GAP, b = offset + w + ROUGH_GAP;
  if (a < END_GAP - 1e-9 || b > L - END_GAP + 1e-9) { ok = false; reason = 'Too close to the end of the wall (keep 0.1 m)'; }
  else for (const q of os) if (a < q.b + OPEN_GAP - 1e-9 && b > q.a - OPEN_GAP + 1e-9) { ok = false; reason = a < q.a ? 'Overlaps the next opening' : 'Overlaps the opening beside it'; break; }
  return { offset, centre: c, sill: sl, snap: name, headLine, guides, ok, reason };
}
