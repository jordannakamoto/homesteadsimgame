// Interior finishes (docs/design/interior-finishes.md): the paint palette and how primer and paint go on.
// A finish key is '<paint>_<sheen>', e.g. 'sage_eggshell'; its paint is the made-to-order item 'paint_<key>'.

// A small curated palette of real-looking interior colours: [id, name, hex]
export const PAINTS = Object.freeze([
  ['chalk', 'Chalk white', 0xf1efe8], ['linen', 'Linen', 0xebe3d3], ['oat', 'Oat', 0xdccdb2], ['clay', 'Clay', 0xc7a78a],
  ['sage', 'Sage', 0xb3bea3], ['moss', 'Moss', 0x7f8c66], ['duckegg', 'Duck egg', 0xbcd3cf], ['slate', 'Slate blue', 0x7d8fa3],
  ['ochre', 'Ochre', 0xd2a24c], ['terracotta', 'Terracotta', 0xb86b4b], ['rose', 'Dusty rose', 0xd5aaa2], ['charcoal', 'Charcoal', 0x4a4c4f],
].map((p) => Object.freeze(p)));
export const PAINT = Object.freeze(Object.fromEntries(PAINTS.map((p) => [p[0], p])));
// sheen: how much the dry wall catches the light (0 flat .. 1 glossy)
export const SHEENS = Object.freeze({ matte: Object.freeze({ name: 'Matte', gloss: 0.05 }), eggshell: Object.freeze({ name: 'Eggshell', gloss: 0.18 }), satin: Object.freeze({ name: 'Satin', gloss: 0.3 }), semigloss: Object.freeze({ name: 'Semi-gloss', gloss: 0.5 }) });
export const finishOf = (key) => {
  const [c, sh] = String(key || '').split('_');
  return PAINT[c] ? { key, paint: PAINT[c], id: c, sheen: SHEENS[sh] ? sh : 'eggshell', name: PAINT[c][1], hex: PAINT[c][2] } : null;
};
// The surfaces a building's finishes record, each painted its own colour (src/framing.js finFor): the walls (with a
// colour per face where chosen), the trim, and later the cabinets and furniture by their own piece ids (`items`). Trim
// takes a harder-wearing sheen by default
export const SURFACES = Object.freeze({
  walls: Object.freeze({ name: 'Walls', sheen: 'eggshell', primer: true }),
  trim: Object.freeze({ name: 'Trim', sheen: 'semigloss', primer: false }),
});
// Real practice: PVA primer on new drywall (about 10 m2 a litre), then two finish coats (about 12 m2 a litre each), each
// dry before the next. Game drying: an hour for primer, an hour and a half between paint coats.
export const DECOR = Object.freeze({
  prime: Object.freeze({ coats: 1, dryS: 3600, m2PerL: 10, hex: 0xf4f3ef }),
  paint: Object.freeze({ coats: 2, dryS: 5400, m2PerL: 12 }),
  // how a coat reads: the first is thin (what is under shows through), wet paint is darker and glossier
  firstCoatK: 0.6, wetK: 0.84,
});
