// Carpentry (docs/design/carpentry.md): the stock trim is cut from and the cuts at its ends. Shared by finish carpentry
// now and by cabinets and furniture later. Sizes are real: a colonial casing 2-1/4 x 11/16 in, a colonial base 3-1/4 x 9/16 in.

// profiles: [item id, width (m, across the face), thickness (m, off the wall)]
export const PROFILES = Object.freeze({
  casing: Object.freeze({ item: 'trim_casing', name: 'Casing', widthM: 0.057, thickM: 0.0175 }),
  base: Object.freeze({ item: 'trim_base', name: 'Baseboard', widthM: 0.083, thickM: 0.014 }),
});
// the casing stands back from the edge of the jamb by a small reveal
export const REVEAL_M = 0.005;
// the cut at each end of a part: what the saw does, in words for the cut prompt
export const ENDS = Object.freeze({
  sq: Object.freeze({ name: 'square' }),
  m45: Object.freeze({ name: 'miter', angle: 45 }),
  cope: Object.freeze({ name: 'cope', angle: 45 }),
  scarf: Object.freeze({ name: 'scarf', angle: 45 }),
});
// how to say the cuts of a part: "miter both ends", "square one end, cope the other"
export function cutWords(ends) {
  const [a, b] = (ends || ['sq', 'sq']).map((e) => (ENDS[e] ? e : 'sq'));
  if (a === b) return a === 'sq' ? 'square both ends' : ENDS[a].name + ' both ends';
  return ENDS[a].name + ' one end, ' + ENDS[b].name + ' the other';
}
// finish nails: about 8 g for each metre of trim
export const FINISH_NAILS_KG_PER_M = 0.008;
