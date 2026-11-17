// The site: a plain-data snapshot of everything built, held in simulation state so that structure,
// heat and the other systems can read buildings without knowing anything about build mode.
// The page refreshes it with the command site.setPieces whenever build mode reports a change.

import { MATERIALS, appearanceMaterial } from './materials.js';

// Build mode names its assembly layers in plain words; these are the registry materials they stand for.
export const LAYER_MATERIAL = Object.freeze({
  'air': 'air', 'brick': 'brick_clay', 'clay-roof-tile': 'clay_tile', 'clay-tile': 'clay_tile',
  'cobblestone': 'granite', 'copper-sheet': 'copper', 'fieldstone': 'granite', 'flagstone': 'sandstone',
  'glass': 'float_glass', 'lime-mortar': 'mortar', 'lime-plaster': 'lime_plaster', 'limestone': 'limestone',
  'marble': 'marble', 'sand': 'soil_dry', 'sandstone': 'sandstone', 'slate': 'slate',
  'softwood-boards': 'spf_seasoned', 'softwood-log': 'pine_seasoned', 'softwood-rails': 'spf_seasoned',
  'thatch': 'thatch', 'topsoil': 'soil_moist', 'turf': 'soil_moist', 'wattle-and-daub': 'cob',
  'wood-shingle': 'cedar_shake', 'wool-carpet': 'carpet', 'wrought-iron': 'steel',
  'earth': 'soil_moist', 'underlayment': 'housewrap',
  'asphalt-shingle': 'asphalt_shingle', 'steel-sheet': 'steel_roofing', 'epdm-membrane': 'epdm',
});

const KIND_OF = { wall: 'wall', door: 'wall', window: 'wall', post: 'wall', beam: 'wall', stair: 'wall', tower: 'wall', foundation: 'wall', floor: 'floor', roof: 'roof', path: 'path' };

// Registry id for whatever name a piece or layer carries: already an id, a layer name, or an appearance name.
export function resolveMaterial(name, kind) {
  if (!name) return null;
  if (MATERIALS[name]) return name;
  if (LAYER_MATERIAL[name]) return LAYER_MATERIAL[name];
  const m = appearanceMaterial(name, KIND_OF[kind]) || appearanceMaterial(name);
  return m ? m.id : null;
}

// Turn build mode's pieces into simulation pieces: same shape, materials as registry ids.
// The appearance name is kept as `appearance`. Anything that cannot be resolved is flagged, never guessed.
export function mapPieces(raw) {
  const fix = (p) => {
    const q = { ...p };
    if (p.material !== undefined) {
      q.appearance = p.material;
      const id = resolveMaterial(p.material, p.kind);
      q.material = id; if (!id) q.unknownMaterial = p.material;
    }
    if (Array.isArray(p.layers)) q.layers = p.layers.map((l) => {
      const id = resolveMaterial(l.material, p.kind);
      return id ? { ...l, material: id } : { ...l, material: null, unknownMaterial: l.material };
    });
    if (Array.isArray(p.openings)) q.openings = p.openings.map(fix);
    return q;
  };
  return JSON.parse(JSON.stringify(raw.map(fix)));
}

export const siteSystem = () => ({
  name: 'site',
  init: () => ({ version: 0, pieces: [] }),
  commands: {
    'site.setPieces': (c, p) => { c.s.pieces = p.pieces || []; c.s.version = (c.s.version | 0) + 1; c.emit('site.changed', { version: c.s.version }); },
  },
});

export const piecesOfKind = (site, kind) => site.pieces.filter((p) => p.kind === kind);
