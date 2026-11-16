// Construction content for the homestead game: the stages of a building and why each exists, what the
// plan's shopping lines are bought as, the items the main catalog lacks, how deliveries land, how much
// a person carries, how long each piece takes to put in, the first-shed steps and what finishing opens.
// Text follows docs/CONSTRUCTION.md. The mechanisms that use this are src/sim/core/supply.js (orders,
// stacks, carrying) and src/sim/construction.js (the system); the page's add-on reads it for its wording.

// ---- stages, in the order a building is raised. `needs`: the stages it stands on. `parentFirst`: stages whose
// members of the same wall or gable must be in first. `flat`: its frames are put together lying down, one at a
// time, and then raised.
export const STAGES = Object.freeze([
  { id: 'site', name: 'Site', needs: [], verb: 'Level the ground', what: 'Stake out the plan, then clear and level the ground.', why: 'A building needs flat, firm ground.' },
  { id: 'foundation', name: 'Foundation', needs: ['site'], verb: 'Set the foundation', what: 'Set the pier blocks, posts and beams.', why: 'Keeps the wood off wet ground and spreads the weight.' },
  { id: 'floor-frame', name: 'Floor frame', needs: ['foundation'], verb: 'Frame the floor', what: 'Rim joists round the edge, then joists every 40 cm.', why: 'Joists carry the floor. Closer joists make a stiffer floor.' },
  { id: 'subfloor', name: 'Subfloor', needs: ['floor-frame'], verb: 'Lay the subfloor', what: 'Lay sheets across the joists.', why: 'Gives you a deck to stand and build on.' },
  { id: 'wall-frame', name: 'Wall frames', needs: ['subfloor'], flat: true, verb: 'Frame the walls', what: 'Lay plates and studs flat on the deck, then tilt each wall up.', why: 'Studs carry the roof down to the floor. A header carries the load around a door or window.' },
  { id: 'top-plates', name: 'Top plates', needs: ['wall-frame'], verb: 'Add the top plates', what: 'A second plate along the top, lapping the corners.', why: 'Ties the walls together so they stand as one.' },
  { id: 'roof-frame', name: 'Roof frame', needs: ['top-plates'], verb: 'Set the rafters', what: 'Set the rafters from wall to wall.', why: 'The slope sheds rain and snow. Rafters carry it out to the walls.' },
  { id: 'roof-deck', name: 'Roof deck', needs: ['roof-frame'], verb: 'Sheet the roof', what: 'Fix sheets on the rafters.', why: 'Makes the roof one stiff surface for the roofing to sit on.' },
  { id: 'roofing', name: 'Roofing', needs: ['roof-deck'], verb: 'Lay the roofing', what: 'Roll out the underlayment, then lay the roofing.', why: 'Keeps the water out. After this the building is dried in.' },
  { id: 'sheathing', name: 'Sheathing', needs: ['top-plates'], parentFirst: ['roof-frame'], verb: 'Sheathe the walls', what: 'Fix sheets to the outside of the studs.', why: 'Stops the frame leaning over sideways in the wind.' },
  { id: 'wrap', name: 'Wrap', needs: ['sheathing'], verb: 'Wrap the walls', what: 'Staple housewrap over the sheathing.', why: 'Stops wind and rain getting in while letting damp out.' },
  { id: 'openings', name: 'Windows and doors', needs: ['wrap'], verb: 'Set the door and windows', what: 'Set the window in its opening and hang the door.', why: 'Light, a way in, and they close the building up.' },
  { id: 'cladding', name: 'Cladding', needs: ['openings'], verb: 'Put on the siding', what: 'Nail siding boards over the wrap.', why: 'Protects the wall from weather and sun.' },
  { id: 'insulation', name: 'Insulation', needs: ['roofing', 'sheathing'], verb: 'Insulate', what: 'Fill the spaces between studs and rafters with batts.', why: 'Slows heat leaving in winter and coming in during summer.' },
  { id: 'lining', name: 'Lining', needs: ['insulation'], verb: 'Finish the inside', what: 'Fix boards or panels inside, and lay the floor boards.', why: 'Covers the insulation and makes a finished room.' },
]);
export const STAGE = Object.freeze(Object.fromEntries(STAGES.map((s) => [s.id, s])));
export const STAGE_ORDER = Object.freeze(STAGES.map((s) => s.id));

// ---- what a shopping line is bought as, where the plan's own item is missing or not what a builder buys.
// Keyed by the line's name (the part of its key after the stage). `each`: one whole unit per member.
export const LINE_ITEM = Object.freeze({
  pierblock: { itemId: 'pier_block' },
  felt: { itemId: 'roof_underlayment' },
  roofshingle: { itemId: 'roof_asphalt', label: 'Roof shingles' },
  door: { itemId: 'door_prehung', each: true, label: 'Door, ready hung in its frame' },
  window: { itemId: 'window_shed', each: true, label: 'Window' },
});
// Lines that are not carried: they sit by the stacks and are used up as the work goes on.
export const SITE_SUPPLY = Object.freeze(['nails_framing', 'screws_wood', 'screws_structural']);

// ---- items the main catalog lacks (the orchestrator merges these into src/sim/items.js). Real figures.
export const ITEMS_CONSTRUCTION = Object.freeze({
  pier_block: { id: 'pier_block', name: 'Precast concrete pier block', category: 'stone', unit: 'each', material: 'concrete', dims: { lengthM: 0.3, widthM: 0.3, thicknessM: 0.2 }, massKgPerUnit: 20, priceUsd: 12, blurb: 'Sits on firm ground; a post or beam drops into the top' },
  roof_underlayment: { id: 'roof_underlayment', name: 'Roof underlayment (felt)', category: 'roofing', unit: 'm2', massKgPerUnit: 0.55, priceUsd: 1.1, dims: { thicknessM: 0.0008 }, blurb: 'The waterproof layer under the roofing' },
  door_prehung: { id: 'door_prehung', name: 'Exterior door, pre-hung', category: 'glass', unit: 'each', massKgPerUnit: 38, priceUsd: 180, dims: { lengthM: 2.03, widthM: 0.915, thicknessM: 0.045 }, blurb: 'Comes in its frame with hinges on: set it in the opening and fix it' },
  window_shed: { id: 'window_shed', name: 'Shed window 600 x 900', category: 'glass', unit: 'each', massKgPerUnit: 9, priceUsd: 95, dims: { lengthM: 0.9, widthM: 0.6, thicknessM: 0.08 }, blurb: 'A small fixed window in its own frame' },
  framing_nailer: { id: 'framing_nailer', name: 'Framing nail gun', category: 'tools_power', unit: 'each', massKgPerUnit: 3.8, priceUsd: 230, powerW: 1500, blurb: 'Drives a nail a second. Needs power' },
  ladder: { id: 'ladder', name: 'Extension ladder', category: 'tools_hand', unit: 'each', massKgPerUnit: 11, priceUsd: 140, blurb: 'Lean it on a wall or the eave and climb it: anything higher than you can reach from the ground is worked from the ladder' },
  wheelbarrow: { id: 'wheelbarrow', name: 'Wheelbarrow', category: 'tools_hand', unit: 'each', massKgPerUnit: 18, priceUsd: 120, blurb: 'Carries three armfuls at once' },
});

// ---- the ladder: it comes with the shed order (a line of the top-plates stage), is leaned by hand and climbed
export const LADDER = Object.freeze({ itemId: 'ladder', stage: 'site', lenM: 3.9, footOutM: 0.95, reachUpM: 2.2, climbMps: 1.5, topBelowM: 0.9, why: 'Anything higher than you can reach from the ground is worked from a ladder: the top plates, the roof.' });

// ---- learn once, then sweep: after nailing a few of a kind by hand, that kind is learned and is set and nailed as you sweep along its run
export const LEARN = Object.freeze({
  needed: 2,
  group: Object.freeze({ stud: 'stud', plate: 'plate', header: 'header', joist: 'joist', rafter: 'rafter', beam: 'beam', post: 'post', skid: 'skid', sheathing: 'sheet', membrane: 'sheet', roofing: 'sheet', lining: 'sheet', cladding: 'sheet', insulation: 'sheet' }),
  says: Object.freeze({ stud: 'frame a stud wall', plate: 'lay wall plates', header: 'frame an opening', joist: 'frame a floor', rafter: 'set rafters', beam: 'set a beam', post: 'set posts', skid: 'lay skids', sheet: 'lay sheets' }),
});
export const learnGroup = (kind) => LEARN.group[kind] || null;

// ---- how each item sits in a stack and in the arms: the page draws these forms.
export function itemForm(itemId) {
  if (/^lumber_|^glulam/.test(itemId)) return 'lumber';
  if (/^board_/.test(itemId)) return 'boards';
  if (/^(osb|plywood|gypsum)_/.test(itemId)) return 'sheet';
  if (itemId === 'pier_block') return 'block';
  if (/^(nails|screws)_/.test(itemId)) return 'box';
  if (itemId === 'housewrap' || itemId === 'roof_underlayment' || itemId === 'vapour_barrier' || itemId === 'roof_epdm') return 'roll';
  if (/^roof_/.test(itemId)) return 'bundle';
  if (/^ins_|^straw/.test(itemId)) return 'bale';
  if (itemId === 'door_prehung') return 'door';
  if (itemId === 'window_shed' || /^glass_/.test(itemId)) return 'pane';
  if (itemId === 'concrete_mix' || itemId === 'mortar_mix') return 'bag';
  if (itemId === 'gravel') return 'pile';
  return 'box';
}

// ---- sheet goods are cut to fit. A piece that needs less than a whole sheet takes a matching offcut if one is held,
// else cuts a whole sheet and keeps the rest as an offcut. Offcuts below minKeepM2 are waste.
export const SHEET = Object.freeze({ areaM2: 1.22 * 2.44, minKeepM2: 0.06 });
// How many whole sheets do these pieces take (areas in m2), given the offcuts already held? Pieces are cut biggest first,
// each from the smallest offcut that will do. { sheets, from: ['offcut' | 'new' per piece, in the order given], left: offcuts afterwards }
export function packSheets(areas, held = [], sheetA = SHEET.areaM2, minKeep = SHEET.minKeepM2) {
  const pool = [...held].sort((a, b) => a - b), from = new Array(areas.length);
  let sheets = 0;
  const order = areas.map((a, i) => i).sort((i, j) => areas[j] - areas[i] || i - j);
  for (const i of order) {
    const a = Math.min(areas[i], sheetA);
    let k = pool.findIndex((o) => o >= a - 1e-9);
    if (k >= 0) {
      const rest = pool.splice(k, 1)[0] - a;
      if (rest >= minKeep) { pool.push(Math.round(rest * 1e6) / 1e6); pool.sort((x, y) => x - y); }
      from[i] = 'offcut';
    } else {
      sheets++;
      const rest = sheetA - a;
      if (rest >= minKeep) { pool.push(Math.round(rest * 1e6) / 1e6); pool.sort((x, y) => x - y); }
      from[i] = 'new';
    }
  }
  return { sheets, from, left: pool };
}

// ---- deliveries
export const DELIVERY = Object.freeze({
  delayS: 3600,                       // an hour of world time: under a minute at normal speed
  // the yard: long things (lumber, boards, sheets) side by side in rows, small things in a band in front of them
  layout: Object.freeze({ mergeR: 14, slot: (i, itemId) => (/^(lumber|board|osb|plywood|gypsum|glulam)_/.test(itemId) ? { x: (i % 4) * 1.5, z: Math.floor(i / 4) * 3.4 } : { x: (i % 5) * 1.15, z: -2.5 - Math.floor(i / 5) * 1.2 }) }),
});

// ---- carrying: by hand about what a person lifts comfortably; a tool that carries more raises it
export const GESTURES = Object.freeze([1, 2, 3, 4]);       // pieces per gesture: one place to read it (setting `gesture`, saved with the world)
export const gestureOf = (options) => (options && GESTURES.includes(options.gesture) ? options.gesture : 3);
export const CARRY = Object.freeze({ byHandKg: 30, tools: Object.freeze([{ tool: 'wheelbarrow', kg: 60 }]), slow: 0.85 });
export function carryLimitKg(tools = [], gesture = 3) {
  let kg = CARRY.byHandKg;
  for (const t of CARRY.tools) if (tools.includes(t.tool)) kg = Math.max(kg, t.kg);
  return kg * gesture;
}

// ---- work: blows to put in one member of each kind, and how fast the blows come by the best tool owned
export const WORK = Object.freeze({
  beats: Object.freeze({ site: 8, pier: 3, post: 2, beam: 4, skid: 4, footing: 4, stemwall: 5, slab: 6, joist: 3, plate: 3, stud: 3, header: 4, rafter: 4, sheathing: 4, membrane: 3, cladding: 6, roofing: 6, insulation: 2, lining: 5, door: 6, window: 4 }),
  beatS: 0.33,                        // seconds between blows with a hammer
  tools: Object.freeze([{ tool: 'hammer', speed: 1 }, { tool: 'framing_nailer', speed: 3, power: true }]),
  sound: Object.freeze({ pier: 'scrape', footing: 'scrape', slab: 'scrape', stemwall: 'scrape', site: 'dig', sheathing: 'thunk', membrane: 'rustle', roofing: 'thunk', insulation: 'rustle', door: 'thunk', window: 'thunk' }),
  // by hand: blows to fasten a piece once it is set in place (stamps for a pier block, strokes of the shovel for the site)
  nails: Object.freeze({ site: 6, pier: 2, post: 1, beam: 2, skid: 2, footing: 2, stemwall: 3, slab: 3, joist: 2, plate: 2, stud: 2, header: 2, rafter: 2, sheathing: 3, membrane: 2, cladding: 3, roofing: 3, insulation: 1, lining: 3, door: 2, window: 2 }),
  swingS: 0.3,                        // seconds between swings while the button is held
  reachM: 2.1,                        // arm's reach around the character
  guidedSpeed: 2.5,                     // Guided fills a stage in this many times faster than working by hand
});
export function workSpeed(tools = [], hasPower = false) {
  let k = 0.6;                        // bare hands and a rock
  for (const t of WORK.tools) if (tools.includes(t.tool) && (!t.power || hasPower)) k = Math.max(k, t.speed);
  return k;
}
export const memberBeats = (kind) => WORK.beats[kind] || 2;
export const memberNails = (kind) => WORK.nails[kind] || 2;

// ---- ready-made plans in the plan book
export const PLAN_BOOK = Object.freeze({
  shed: { id: 'shed', name: 'Tool shed', blurb: 'A first building: one room, one door, one window, a single-slope roof.', needs: 'plan:shed', timeMin: 12 },
  cabin: { id: 'cabin', name: 'Small cabin', blurb: 'A place to live: gable roof, two windows, insulated and lined.', needs: 'plan:cabin', timeMin: 35 },
});

// ---- what finishing things opens (docs/CONSTRUCTION.md, "Unlocks")
export const UNLOCKS = Object.freeze([
  { when: 'start', opens: ['plan:tent', 'plan:shed', 'found:pier-blocks', 'method:stick-frame', 'roof:metal', 'roof:shingle'], says: '' },
  { when: 'plan:shed', opens: ['plan:cabin', 'plan:draw', 'choice:windows', 'choice:insulation', 'fixture:wood-stove'], says: 'The small cabin plan, drawing your own plans, window and insulation choices, the wood stove' },
  { when: 'plan:cabin', opens: ['found:piers', 'found:slab', 'plan:larger', 'method:timber-frame', 'fixture:power', 'fixture:water'], says: 'Concrete piers and slabs, larger plans, timber frame, power and water equipment' },
  { when: 'buildings:2', opens: ['method:log', 'found:stemwall', 'plan:a-frame'], says: 'Log construction, stem-wall foundations, the A-frame' },
]);
export const ALL_UNLOCKS = Object.freeze([...new Set(UNLOCKS.flatMap((u) => u.opens))]);

// ---- the first shed: thirteen steps, each pointing at stages of the build (docs/CONSTRUCTION.md)
export const FIRST_SHED = Object.freeze({
  projectId: 'first-shed',
  title: 'Build your first shed',
  blurb: 'Open the Build panel (L) and choose the tool shed. The panel always shows the next step and why it comes next: place it, order the kit, and raise it from pier blocks to roof.',
  steps: Object.freeze([
    { n: 1, does: 'Choose where the shed goes', teaches: 'Buildings start as a plan on the ground.', until: 'placed' },
    { n: 2, does: 'Order the shed kit', teaches: 'How much material a small building is, and what each stack is.', until: 'ordered' },
    { n: 3, does: 'Level the ground and set six pier blocks', teaches: 'Foundations keep wood dry and carry the load.', stages: ['site', 'foundation'] },
    { n: 4, does: 'Build the floor frame, then the subfloor', teaches: 'Joists and spacing. You now have a deck.', stages: ['floor-frame', 'subfloor'] },
    { n: 5, does: 'Frame the back wall flat on the deck and tilt it up', teaches: 'Plates and studs, and the tilt-up.', stages: ['wall-frame'], walls: 1 },
    { n: 6, does: 'Frame the side walls and the front wall with its door opening', teaches: 'Headers carry load around an opening.', stages: ['wall-frame'] },
    { n: 7, does: 'Add the top plates', teaches: 'Tying the walls together.', stages: ['top-plates'] },
    { n: 8, does: 'Set the rafters', teaches: 'Pitch, and why roofs slope.', stages: ['roof-frame'] },
    { n: 9, does: 'Roof deck, underlayment and roofing', teaches: 'Dried in: rain now stays outside.', stages: ['roof-deck', 'roofing'] },
    { n: 10, does: 'Sheathe the walls', teaches: 'Sheets stop the frame swaying.', stages: ['sheathing'] },
    { n: 11, does: 'Wrap the walls, set the window and hang the door', teaches: 'Closing the envelope.', stages: ['wrap', 'openings'] },
    { n: 12, does: 'Put on the siding', teaches: 'Protecting the wall.', stages: ['cladding'] },
    { n: 13, does: 'Finish the inside', teaches: 'A finished room, and insulation seen as a number.', stages: ['insulation', 'lining'] },
  ]),
});

// ---- the banners for the moments worth stopping for
export const MOMENTS = Object.freeze({
  deck: { title: 'You have a deck', line: 'Somewhere flat to stand and frame the walls.' },
  wallUp: { title: 'Wall up', line: 'Braced for now. Sheathing will make it stay.' },
  firstRafter: { title: 'First rafter set', line: 'The slope that sheds the rain.' },
  framed: { title: 'Framed', line: 'It has the shape of a building now.' },
  driedIn: { title: 'Dried in', line: 'Rain stays outside from now on.' },
  doorHung: { title: 'Door hung', line: 'A way in that closes.' },
  finished: { title: 'Finished', line: 'You built this.' },
});
