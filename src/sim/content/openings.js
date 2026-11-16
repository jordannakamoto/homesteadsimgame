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
  pivot: 'turns on a pivot pin set in from the edge',
});

// sill presets for windows, metres above the floor
export const SILL_PRESETS = Object.freeze({ standard: 0.9, counter: 1.07, low: 0.45, high: 1.5 });

// w, h: standard widths and heights. sill/head: default heights above the floor (doors: sill 0).
// look: panels across, grid (muntins across x down), track (a rail is visible), arch (round top).
const T = (id, name, kind, op, w, h, sill, extra) => ({
  id, name, kind, op, w, h, sill, store: kind === 'door' ? 'doors' : 'windows',
  look: { panels: 1, grid: [1, 1], track: false, arch: false, ...(extra.look || {}) },
  finish: extra.finish || (kind === 'door' ? 'wood' : 'white'),
  mass: extra.mass, price: extra.price, frame: extra.frame || 'wall', ...(extra.more || {}),
});

// colours a unit can be finished in (id -> { name, hex }). The last few are door stains and paints.
export const FINISHES = Object.freeze({
  white: { name: 'White', hex: 0xf1eee6 }, cream: { name: 'Cream', hex: 0xe6dcc3 }, black: { name: 'Black', hex: 0x1e1e20 },
  bronze: { name: 'Bronze', hex: 0x4a3b2c }, wood: { name: 'Wood', hex: 0x6f4d2c }, sage: { name: 'Sage', hex: 0x96a487 },
  green: { name: 'Green', hex: 0x2f4a3b }, red: { name: 'Red', hex: 0x7c2b24 }, blue: { name: 'Blue', hex: 0x2b3d58 },
  // doors
  oak: { name: 'Oak stain', hex: 0xa7743f }, walnut: { name: 'Walnut', hex: 0x48301f }, charcoal: { name: 'Charcoal', hex: 0x45484b }, mustard: { name: 'Mustard', hex: 0xc99a34 },
});

// ---- the door designer: what a swinging door looks like (sp.look). Keys a door type sets in its look, and a placed
// door may override in f.look. face: the panel layout. glass: where the lites are. bars: muntins divide the glass.
// side: sidelights beside the leaf (one rough opening, one unit). transom: a lite over it. hw / metal: the handle.
export const DOOR_FACES = Object.freeze({
  flush: 'Flush', groove: 'Grooved', shaker: 'Shaker', p2: '2 panel', p3: '3 panel', p5: '5 panel', p6: '6 panel', plank: 'Plank',
});
export const DOOR_GLASS = Object.freeze({ none: 'No glass', top: 'Top lite', half: 'Half lite', three: '¾ lite', full: 'Full glass', craft: 'Craftsman', slot: 'Slot' });
export const DOOR_SIDES = Object.freeze({ none: 'None', left: 'Left', right: 'Right', both: 'Both' });
export const DOOR_HW = Object.freeze({ knob: 'Knob', lever: 'Lever', pull: 'Long pull' });
export const DOOR_METALS = Object.freeze({ brass: { name: 'Brass', hex: 0xb89a4c }, black: { name: 'Black', hex: 0x18181a }, steel: { name: 'Steel', hex: 0x9fa2a5 } });
export const SIDE_W = 0.36;              // a sidelight unit, frame included
export const TRANSOM_H = 0.36;           // a transom over the door, frame included
const DESIGN_OPS = new Set(['swing', 'dutch', 'pivot']);
// which door types the designer shapes (hinged and pivot leaves), and which of them may take sidelights and a transom
export const designable = (t) => !!t && t.kind === 'door' && DESIGN_OPS.has(t.op) && t.frame === 'wall' && !t.surface;
export const DOOR_LOOK = Object.freeze({ face: 'flush', glass: 'none', bars: false, side: 'none', transom: false, hw: 'knob', metal: 'brass' });
// a unit's look: the type's, then the placed one's own choices
export const lookOf = (t, f) => (designable(t) ? { ...DOOR_LOOK, ...t.look, ...((f && f.look) || {}) } : { ...t.look, ...((f && f.look) || {}) });

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
  // ---- doors. The swinging ones are presets of the door designer (look: face, glass, bars, hw, metal; finish).
  T('door_single', 'Six-panel door (colonial)', 'door', 'swing', [0.76, 0.81, 0.915], [2.03, 2.13], 0, { mass: 38, price: 180, finish: 'white', look: { grid: [1, 1], face: 'p6', hw: 'knob', metal: 'brass' } }),
  T('door_craftsman', 'Craftsman door', 'door', 'swing', [0.81, 0.915, 1.07], [2.03, 2.13], 0, { mass: 44, price: 420, finish: 'oak', look: { face: 'p3', glass: 'craft', hw: 'lever', metal: 'black' } }),
  T('door_farmhouse', 'Farmhouse plank door', 'door', 'swing', [0.81, 0.915], [2.03, 2.13], 0, { mass: 46, price: 300, finish: 'sage', look: { face: 'plank', glass: 'top', bars: true, hw: 'lever', metal: 'black' } }),
  T('door_pivot', 'Modern pivot door', 'door', 'pivot', [1.07, 1.22, 1.52], [2.13, 2.44], 0, { mass: 80, price: 1400, finish: 'walnut', look: { face: 'groove', glass: 'slot', hw: 'pull', metal: 'black' } }),
  T('door_glass', 'Steel-frame glass door', 'door', 'swing', [0.81, 0.915, 1.07], [2.03, 2.13, 2.44], 0, { mass: 52, price: 900, finish: 'black', look: { face: 'flush', glass: 'full', bars: true, hw: 'pull', metal: 'black' } }),
  T('door_interior', 'Interior shaker door', 'door', 'swing', [0.61, 0.71, 0.76, 0.81], [2.03], 0, { mass: 14, price: 95, finish: 'white', look: { face: 'shaker', hw: 'lever', metal: 'steel' }, more: { thin: true } }),
  T('door_french', 'Double / French door', 'door', 'swing', [1.22, 1.52, 1.83], [2.03, 2.13], 0, { mass: 70, price: 520, finish: 'white', look: { panels: 2, grid: [3, 5], face: 'shaker', glass: 'full', bars: true, hw: 'lever', metal: 'brass' } }),
  T('door_dutch', 'Dutch door', 'door', 'dutch', [0.81, 0.915], [2.03], 0, { mass: 42, price: 340, finish: 'blue', look: { panels: 2, face: 'shaker', glass: 'half', bars: true, hw: 'knob', metal: 'brass' } }),
  T('door_patio', 'Sliding patio door', 'door', 'slide', [1.83, 2.44, 3.05], [2.03, 2.13], 0, { mass: 95, price: 780, look: { panels: 2, track: true } }),
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
      out[id] = { id, name: `${t.name} ${Math.round(w * 1000)} x ${Math.round(h * 1000)}`, category: t.store, store: t.store, unit: 'each', massKgPerUnit: Math.round(t.mass * (w * h) / ref * 10) / 10 || t.mass, priceUsd: Math.round(t.price * k), dims: { lengthM: h, widthM: w, thicknessM: t.kind === 'door' ? 0.045 : 0.08 }, blurb: `${t.name}: ${OPERATION[t.op]}` };
    }
  }
  return out;
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

// everything a free opening needs: the type, its size, the unit box, the rough opening and the header it needs
export function freeSpec(f) {
  const t = OPENING_BY_ID[f.typeId];
  if (!t) return null;
  const sizes = openingSizes(t), s = f.w > 0 && f.h > 0 ? { w: f.w, h: f.h } : sizes[Math.min(Math.max(0, f.sizeIdx | 0), sizes.length - 1)];
  const sill = t.kind === 'door' ? 0 : (f.sill === undefined ? t.sill : f.sill);
  const look = lookOf(t, f);
  // a designed door with sidelights or a transom is one bigger unit in one rough opening; the leaf sits inside it
  let w = s.w, h = s.h, leaf = null;
  if (designable(t)) {
    const sl = look.side === 'left' || look.side === 'both' ? SIDE_W : 0, sr = look.side === 'right' || look.side === 'both' ? SIDE_W : 0;
    w = Math.round((s.w + sl + sr) * 1000) / 1000; h = Math.round((s.h + (look.transom ? TRANSOM_H : 0)) * 1000) / 1000;
    leaf = { a: sl, b: sl + s.w, h: s.h };
  }
  const rough = roughOpening(t, w, h, sill);
  return { type: t, w, h, sill, head: sill + h, rough, header: headerSpec(rough.width), itemId: openingItemId(t.id, w, h), finish: f.finish || t.finish, look, leaf };
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
