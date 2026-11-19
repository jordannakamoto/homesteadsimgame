// Construction content for the homestead game: the stages of a building and why each exists, what the
// plan's shopping lines are bought as, the items the main catalog lacks, how deliveries land, how much
// a person carries, how long each piece takes to put in, the first-shed steps and what finishing opens.
// Text follows docs/CONSTRUCTION.md. The mechanisms that use this are src/sim/core/supply.js (orders,
// stacks, carrying) and src/sim/construction.js (the system); the page's add-on reads it for its wording.

import { SERVICE_SUPPLY } from './services.js';
import { DECK_SUPPLY } from './deck.js';
export { PAINTS, PAINT, SHEENS, SURFACES, finishOf, DECOR } from './decor.js';
export { PROFILES, REVEAL_M, ENDS, cutWords, FINISH_NAILS_KG_PER_M } from './carpentry.js';

// ---- stages, in the order a building is raised. `hint` + `handsKey`: the tool and key the construction note names when the job is a
// slab, stem wall or pier foundation (hand-built in the Site tool, key 7). `by` is NOT set on these: a stage with `by` is tallied by
// another system and skips the pieces; here the pieces and the job both count. `needs`: the stages it stands on. `parentFirst`: stages whose
// members of the same wall or gable must be in first. `flat`: its frames are put together lying down, one at a
// time, and then raised.
export const STAGES = Object.freeze([
  { id: 'site', name: 'Site', needs: [], hint: 'Site (7): lay the strings out, dig to the line and rake the base level', handsKey: '7', verb: 'Level the ground', what: 'Stake out the plan, then clear and level the ground.', why: 'A building needs flat, firm ground.' },
  { id: 'foundation', name: 'Foundation', needs: ['site'], hint: 'Site (7): set the forms and rebar, pour, finish and cure the concrete', handsKey: '7', verb: 'Set the foundation', what: 'Set the pier blocks, posts and beams.', why: 'Keeps the wood off wet ground and spreads the weight.' },
  { id: 'floor-frame', name: 'Floor frame', needs: ['foundation'], verb: 'Frame the floor', what: 'Rim joists round the edge, then joists every 40 cm.', why: 'Joists carry the floor. Closer joists make a stiffer floor.' },
  { id: 'subfloor', name: 'Subfloor', needs: ['floor-frame'], verb: 'Lay the subfloor', what: 'Lay sheets across the joists.', why: 'Gives you a deck to stand and build on.' },
  { id: 'wall-frame', name: 'Wall frames', needs: ['subfloor'], flat: true, verb: 'Frame the walls', what: 'Lay plates and studs flat on the deck, then tilt each wall up.', why: 'Studs carry the roof down to the floor. A header carries the load around a door or window.' },
  { id: 'top-plates', name: 'Top plates', needs: ['wall-frame'], verb: 'Add the top plates', what: 'A second plate along the top, lapping the corners.', why: 'Ties the walls together so they stand as one.' },
  { id: 'roof-frame', name: 'Roof frame', needs: ['top-plates'], verb: 'Set the rafters', what: 'Set the rafters from wall to wall.', why: 'The slope sheds rain and snow. Rafters carry it out to the walls.' },
  { id: 'roof-deck', name: 'Roof deck', needs: ['roof-frame', 'porch-frame'], verb: 'Sheet the roof', what: 'Fix sheets on the rafters.', why: 'Makes the roof one stiff surface for the roofing to sit on.' },
  { id: 'dry-in', name: 'Dry-in', needs: ['roof-deck'], verb: 'Dry in the roof', what: 'Drip edge along the eaves, then underlayment strips from the eave up, each lapping the one below, then drip edge up the rakes.', why: 'Water runs downhill: every layer laps over the one below it, so rain is led out over the edge and never under it.' },
  { id: 'roofing', name: 'Roofing', needs: ['dry-in'], verb: 'Lay the roofing', what: 'Work from on the roof: a starter strip at the eave, then course after course up the slope, the ridge cap last. On a steep roof, clip in at a ridge anchor first.', why: 'Keeps the water out. After this the building is dried in.' },
  { id: 'sheathing', name: 'Sheathing', needs: ['top-plates'], parentFirst: ['roof-frame'], verb: 'Sheathe the walls', what: 'Fix sheets to the outside of the studs.', why: 'Stops the frame leaning over sideways in the wind.' },
  { id: 'wrap', name: 'Wrap', needs: ['sheathing'], verb: 'Wrap the walls', what: 'Staple housewrap over the sheathing.', why: 'Stops wind and rain getting in while letting damp out.' },
  { id: 'openings', name: 'Windows and doors', needs: ['wrap'], verb: 'Set the door and windows', what: 'Set the window in its opening and hang the door.', why: 'Light, a way in, and they close the building up.' },
  { id: 'cladding', name: 'Cladding', needs: ['openings'], verb: 'Put on the siding', what: 'Nail siding boards over the wrap.', why: 'Protects the wall from weather and sun.' },
  { id: 'gutters', name: 'Gutters', needs: ['roofing', 'cladding'], verb: 'Hang the gutters', what: 'From the ladder or scaffold: gutters along the eaves, falling a little toward a downspout at one end.', why: 'They catch the rain off the roof and carry it away from the foundation, or into a rain barrel.' },
  // rough-in and trim-out are tallied by the services system (src/sim/services.js) through construction.setExternal: `by` names
  // it. A stage with nothing in it counts as complete, so a building with no cable or pipe planned goes on exactly as before.
  { id: 'rough-in', name: 'Rough-in', needs: ['roofing', 'sheathing'], by: 'services', hint: 'Rough-in: Hands (F), then pick Power or Water', verb: 'Run the pipes and cables', what: 'Drill the studs, pull cable and pipe to each box and stub.', why: 'Everything inside a wall goes in while you can still see the studs.' },
  { id: 'insulation', name: 'Insulation', needs: ['roofing', 'sheathing', 'rough-in'], verb: 'Insulate', what: 'Fill the spaces between studs and rafters with batts.', why: 'Slows heat leaving in winter and coming in during summer.' },
  { id: 'lining', name: 'Lining', needs: ['insulation'], verb: 'Hang the walls', what: 'Hang drywall sheet by sheet, top row first, or put up pine boards from the floor up; lay the floor boards.', why: 'Covers the insulation and makes a finished room.' },
  { id: 'finish', name: 'Tape and mud', needs: ['lining'], verb: 'Tape and mud', what: 'Tape every drywall seam, give it three coats of compound, letting each dry, then sand it smooth.', why: 'Hides the joints so the walls read as one surface. Board walls need none of this.' },
  { id: 'carpentry', name: 'Trim carpentry', needs: ['lining', 'finish'], verb: 'Fit the trim', what: 'Casings round the doors and windows, then baseboard along the floor, each piece cut to fit at the sawhorses.', why: 'Covers the gaps where the walls meet the floor and the frames, and finishes the room.' },
  { id: 'decorate', name: 'Paint', needs: ['cladding', 'lining', 'finish', 'carpentry'], verb: 'Paint', what: 'A coat of primer on the new walls, then two coats of colour, each dry before the next; two coats on the trim, which comes primed.', why: 'Seals the drywall or boards and gives the room its colour.' },
  { id: 'trim-out', name: 'Trim-out', needs: ['lining', 'finish', 'decorate'], by: 'services', hint: 'Trim-out: Do it for me, in the Build panel (L)', verb: 'Fit the devices and fixtures', what: 'Outlets, switches and lights into their boxes; breakers into the panel; taps and fixtures onto their stubs.', why: 'The wall is finished now, so what you touch goes on its face.' },
  // decks (src/sim/content/deck.js, src/game/deck.js): the piers, posts and beam are foundation members; the ledger bolts through
  // the house's sheathing, so the frame waits for it (a free-standing deck has none: an empty stage counts as done)
  { id: 'deck-frame', name: 'Deck frame', needs: ['foundation', 'sheathing'], verb: 'Frame the deck', what: 'Bolt the ledger to the house rim through the sheathing, flash it, hang the joists every 40 cm, close the ends with the rim.', why: 'The ledger and the beam carry the joists; the joists carry the boards.' },
  { id: 'decking', name: 'Decking', needs: ['deck-frame'], verb: 'Lay the deck boards', what: 'Boards across the joists from the house out, a 5 mm gap between them, two screws at every joist. Hold and drag along a row once you have the knack.', why: 'The gaps let the rain through and the boards move with the weather.' },
  // a porch roof (B-3): its posts, header, wall ledger and rafters are their own stage so the house's order is untouched (an empty
  // stage counts as done); its sheets, flashing and shingles go in with the house's roof-deck, dry-in and roofing
  { id: 'porch-frame', name: 'Porch frame', needs: ['top-plates'], verb: 'Frame the porch roof', what: 'Set the 6 x 6 posts on the deck frame, lift the header onto them, bolt the roof ledger to the house wall, then set the rafters from the ledger down to the header.', why: 'The roof is one slope that leans on the house wall and rests on the posts.' },
  // guards and stairs (B-3): after the boards are down
  { id: 'rails', name: 'Rails and stairs', needs: ['decking'], verb: 'Build the rails and stairs', what: 'Set the guard posts, run the rails between them, set the balusters; cut the stringers to the rise and run, lay the landing pad, then the risers and treads and the handrail.', why: 'A guard keeps people off a drop of 30 in or more; stairs with even risers are safe to walk without looking.' },
]);
// ---- taping drywall (docs/design/interior-walls.md). Each seam takes the tape and a first coat, then a fill coat and a
// finish coat, each laid on dry compound, then a light sanding. Setting compound can take the next coat in about an hour
// and a half; the passes are refused on wet mud. Coat widths are what the view draws.
export const FINISH = Object.freeze({ coats: 3, dryS: 5400, widthsM: Object.freeze([0.06, 0.16, 0.26]), kgPerM: 0.3 });
export const STAGE = Object.freeze(Object.fromEntries(STAGES.map((s) => [s.id, s])));
export const STAGE_ORDER = Object.freeze(STAGES.map((s) => s.id));

// ---- support order inside a stage: a piece of the kind on the left waits until every piece of the kinds on the right,
// in the same stage, is built. (Across stages, `needs` above does it.) `says`: the hint when it waits.
export const SUPPORT = Object.freeze({
  pier: ['footing'], post: ['pier'], skid: ['footing'], slab: ['footing'], stemwall: ['footing'],
  beam: ['pier', 'post', 'footing', 'stemwall'], rafter: ['beam'],
  rail: ['guardpost'], baluster: ['rail'], stringer: ['landing'], tread: ['stringer'],   // a deck's guard and stair (B-3)
  joist: ['ledger'],   // a deck's joists hang on its ledger (a house floor has no ledger in its frame stage)
  // drying in and roofing, the order roofers lay them: each layer laps the one below
  membrane: ['drip'], rake: ['membrane'], ridgecap: ['roofing'], downspout: ['gutter'],
});
export const SUPPORT_SAYS = Object.freeze({ ledger: 'Bolt the ledger on', footing: 'Lay the footings', pier: 'Set the pier blocks', post: 'Set the posts', stemwall: 'Pour the stem wall', beam: 'Set the ridge beam', drip: 'Fit the drip edge along the eaves', membrane: 'Lay the underlayment', roofing: 'Lay every course', gutter: 'Hang the gutter', guardpost: 'Set the guard posts', rail: 'Run the rails', landing: 'Lay the landing pad', stringer: 'Cut and set the stringers' });

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
export const SITE_SUPPLY = Object.freeze(['nails_framing', 'screws_wood', 'screws_structural', ...SERVICE_SUPPLY, ...DECK_SUPPLY]);

// ---- items the main catalog lacks (the orchestrator merges these into src/sim/items.js). Real figures.
export const ITEMS_CONSTRUCTION = Object.freeze({
  pier_block: { id: 'pier_block', name: 'Precast concrete pier block', category: 'stone', unit: 'each', material: 'concrete', dims: { lengthM: 0.3, widthM: 0.3, thicknessM: 0.2 }, massKgPerUnit: 20, priceUsd: 12, blurb: 'Sits on firm ground; a post or beam drops into the top' },
  roof_underlayment: { id: 'roof_underlayment', name: 'Roof underlayment (felt)', category: 'roofing', unit: 'm2', massKgPerUnit: 0.55, priceUsd: 1.1, dims: { thicknessM: 0.0008 }, blurb: 'The waterproof layer under the roofing' },
  door_prehung: { id: 'door_prehung', name: 'Exterior door, pre-hung', category: 'glass', unit: 'each', massKgPerUnit: 38, priceUsd: 180, dims: { lengthM: 2.03, widthM: 0.915, thicknessM: 0.045 }, blurb: 'Comes in its frame with hinges on: set it in the opening and fix it' },
  roof_corrugated: { id: 'roof_corrugated', name: 'Corrugated steel sheet', category: 'roofing', unit: 'm2', massKgPerUnit: 4.5, priceUsd: 14, dims: { thicknessM: 0.0005 }, blurb: 'Wavy galvanised sheets screwed through the crests: cheap and quick, for sheds and barns' },
  roof_green: { id: 'roof_green', name: 'Sedum mat (green roof)', category: 'roofing', unit: 'm2', massKgPerUnit: 20, priceUsd: 60, dims: { thicknessM: 0.07 }, blurb: 'Rolls of living sedum on a growing mat, laid over a waterproof membrane' },
  roof_ice_water: { id: 'roof_ice_water', name: 'Ice and water shield', category: 'roofing', unit: 'm2', massKgPerUnit: 1.3, priceUsd: 3.5, dims: { thicknessM: 0.001 }, blurb: 'Self-sticking rubberised membrane for the eaves and valleys' },
  drip_edge: { id: 'drip_edge', name: 'Drip edge, 10 ft', category: 'roofing', unit: 'm', massKgPerUnit: 0.35, priceUsd: 2.6, blurb: 'Bent aluminium edge for the eaves and rakes: water drips off it clear of the fascia' },
  ridge_cap: { id: 'ridge_cap', name: 'Ridge cap', category: 'roofing', unit: 'm', massKgPerUnit: 1.6, priceUsd: 9, blurb: 'Caps the ridge or a hip, lapped over the top courses' },
  gutter_alu: { id: 'gutter_alu', name: 'Aluminium gutter, 5 in K-style', category: 'roofing', unit: 'm', massKgPerUnit: 0.9, priceUsd: 10, blurb: 'Hung under the eave on hidden hangers, with a slight fall to the downspout' },
  downspout_alu: { id: 'downspout_alu', name: 'Aluminium downspout, 2 x 3 in', category: 'roofing', unit: 'm', massKgPerUnit: 0.6, priceUsd: 7.5, blurb: 'Takes the water from the gutter down to the ground' },
  window_shed: { id: 'window_shed', name: 'Shed window 600 x 900', category: 'glass', unit: 'each', massKgPerUnit: 9, priceUsd: 95, dims: { lengthM: 0.9, widthM: 0.6, thicknessM: 0.08 }, blurb: 'A small fixed window in its own frame' },
  framing_nailer: { id: 'framing_nailer', name: 'Framing nail gun', category: 'tools_power', unit: 'each', massKgPerUnit: 3.8, priceUsd: 230, powerW: 1500, blurb: 'Drives a nail a second. Needs power' },
  ladder: { id: 'ladder', name: 'Extension ladder', category: 'tools_hand', unit: 'each', massKgPerUnit: 11, priceUsd: 140, blurb: 'Lean it on a wall or the eave and climb it: anything higher than you can reach from the ground is worked from the ladder' },
  wheelbarrow: { id: 'wheelbarrow', name: 'Wheelbarrow', category: 'tools_hand', unit: 'each', massKgPerUnit: 18, priceUsd: 120, blurb: 'Carries three armfuls at once' },
});

// ---- the ladder: it comes with the shed order (a line of the top-plates stage), is leaned by hand and climbed
export const LADDER = Object.freeze({ itemId: 'ladder', stage: 'site', with: Object.freeze(['wall-frame', 'top-plates', 'roof-frame', 'roof-deck', 'dry-in', 'roofing', 'sheathing', 'wrap', 'cladding', 'gutters']), lenM: 3.9, footOutM: 0.95, reachUpM: 2.2, climbMps: 4.5, topBelowM: 0.9, why: 'Anything higher than you can reach from the ground is worked from a ladder: the top plates, the roof.' });

// ---- on the roof: once a plane is decked you can walk on it, slower the steeper it is. A roof anchor screwed through the deck
// at the ridge, a harness and a rope grab: clipped in you cannot go past the edge (fall restraint). Unclipped on a roof steeper
// than slideK (rise over run: 6 in 12) you slide slowly down to the eave and stop there. Nobody is hurt: this is a peaceful game.
export const ROOFWALK = Object.freeze({ slideK: 0.5, slideMps: 0.55, ropeM: 14, anchorReachM: 1.3, edgeM: 0.22, says: 'Clip in at the ridge anchor before working on a steep roof' });

// ---- scaffolding: rented by the day from the Build panel, it arrives as a bundle of frames and planks by the stacks. Set up
// along a wall it is a platform a bay long with a guard rail and a ladder at one end; walk into the ladder to climb, walk the
// plank, and the top plates, rafter tails, roof edge and the top of the siding are all in reach. Collected when the days run out.
export const SCAFFOLD = Object.freeze({ itemId: 'scaffold_bay', usdPerDay: 35, days: 3, bayM: 2.6, widthM: 0.75, belowTopM: 1.35, minDeckM: 0.9, standOffM: 0.3, towerM: 1.9, towerBelowTopM: 0.6, why: 'Steel scaffolding: a platform along a wall, or a tower on the floor inside the frame for the ridge and rafters. Safer and quicker than a ladder, and you can walk along it.' });
export const ITEMS_SCAFFOLD = Object.freeze({
  scaffold_bay: { id: 'scaffold_bay', name: 'Scaffold bay (rented, per day)', category: 'rental', unit: 'day', massKgPerUnit: 0, priceUsd: SCAFFOLD.usdPerDay, blurb: 'Two frames, braces, planks, a guard rail and a ladder, set up along one wall' },
});

// ---- learn once, then sweep: after nailing a few of a kind by hand, that kind is learned and is set and nailed as you sweep along its run
export const LEARN = Object.freeze({
  needed: 2,
  group: Object.freeze({ stud: 'stud', plate: 'plate', header: 'header', joist: 'joist', rafter: 'rafter', beam: 'beam', post: 'post', skid: 'skid', sheathing: 'sheet', membrane: 'sheet', roofing: 'course', lining: 'sheet', cladding: 'sheet', insulation: 'sheet', drip: 'flashing', rake: 'flashing', ridgecap: 'flashing', gutter: 'gutter', downspout: 'gutter', decking: 'deckboard', tread: 'deckboard', guardpost: 'post', rail: 'rail', baluster: 'baluster', stringer: 'stringer' }),
  says: Object.freeze({ stud: 'frame a stud wall', plate: 'lay wall plates', header: 'frame an opening', joist: 'frame a floor', rafter: 'set rafters', beam: 'set a beam', post: 'set posts', skid: 'lay skids', sheet: 'lay sheets', course: 'lay a roof course', flashing: 'fit drip edge and flashing', gutter: 'hang gutters', deckboard: 'lay deck boards', rail: 'run guard rails', baluster: 'set balusters', stringer: 'set stair stringers' }),
});
export const learnGroup = (kind) => LEARN.group[kind] || null;

// ---- how each item sits in a stack and in the arms: the page draws these forms.
export function itemForm(itemId) {
  if (/^(cut_)?(lumber|trim)_|^glulam/.test(itemId)) return 'lumber';
  if (/^board_/.test(itemId)) return 'boards';
  if (/^(osb|plywood|gypsum)_/.test(itemId)) return 'sheet';
  if (itemId === 'pier_block' || itemId === 'stair_pad') return 'block';
  if (/^(nails|screws)_/.test(itemId) || itemId === 'caulk_acrylic') return 'box';
  if (itemId === 'housewrap' || itemId === 'roof_underlayment' || itemId === 'vapour_barrier' || itemId === 'roof_epdm' || itemId === 'roof_ice_water' || itemId === 'roof_green') return 'roll';
  if (itemId === 'drip_edge' || itemId === 'ridge_cap' || itemId === 'gutter_alu' || itemId === 'downspout_alu') return 'trim';
  if (/^roof_/.test(itemId)) return 'bundle';
  if (/^ins_|^straw/.test(itemId)) return 'bale';
  if (itemId === 'door_prehung' || /^op_door_/.test(itemId)) return 'door';
  if (itemId === 'window_shed' || /^op_/.test(itemId) || /^glass_/.test(itemId)) return 'pane';
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

// ---- lumber comes in stock lengths (8, 10, 12, 14, 16, 18 and 20 ft), not by the metre to any length. Each piece is cut
// from a stick with the saw: from a kept offcut if one is long enough, else from a new stick of the shortest stock length
// that holds it. What is left is kept as an offcut (cripples and short pieces come out of them) or, under minKeepM, is
// scrap. A saw cut takes kerfM. A piece longer than the longest stock is spliced from two in the plan (src/framing.js).
export const STICK = Object.freeze({ stocksM: Object.freeze([2.4, 3.0, 3.6, 4.2, 4.8, 5.4, 6.0]), kerfM: 0.003, minKeepM: 0.3, ft: Object.freeze({ 2.4: 8, 3: 10, 3.6: 12, 4.2: 14, 4.8: 16, 5.4: 18, 6: 20 }) });
export const isStickItem = (itemId) => /^(lumber|trim)_/.test(itemId);     // framing lumber and trim mouldings, in stock lengths
// ---- what comes cut from the yard and what you cut yourself. Lumberyards sell studs precut and cut plates, joists and beams
// to length on the order, so most pieces arrive ready to go in. The cuts a carpenter really makes on site are the short and
// fitted pieces and the angled ones: posts cut to height once the piers are level, blocking, cripples under sills and over
// headers, gable studs, rafters and hips with their plumb cuts and seat cuts, and any stub under stubM. Those are bought as stock sticks and cut at the sawhorses as a job of their own;
// each cut piece goes into the arms (an armful at most) or onto the horses.
export const SITE_CUT = Object.freeze({ kinds: Object.freeze(['block', 'cripple', 'rafter', 'hip', 'post', 'casing', 'base', 'stool']), armful: 6, shortM: 1.5, stubM: 0.6,
  says: 'Cut it at the sawhorses first', why: 'Posts, blocking, cripples and rafters are cut on site, to fit; everything else comes cut to length from the yard' });
export const isSiteCut = (kind, len) => SITE_CUT.kinds.includes(kind) || (len > 0 && len < SITE_CUT.stubM) || ((kind === 'stud' || kind === 'jack') && len > 0 && len < SITE_CUT.shortM);
// the pieces cut at the sawhorses from a lumber item, carried and stacked like any other item
export const cutItemOf = (itemId) => 'cut_' + itemId;
export const isCutItem = (itemId) => /^cut_(lumber|trim)_/.test(itemId);
// the stock length a new stick for a piece this long is bought as
export function stockFor(len, stocks = STICK.stocksM) {
  for (const L of stocks) if (L >= len - 1e-9) return L;
  return Math.ceil((len - 1e-9) / 0.6) * 0.6;                 // a special long order
}
// What is left of a stick of length L after a piece of length len is cut from it (no cut, no kerf, when it fits exactly).
export const restAfter = (L, len, kerf = STICK.kerfM) => (L - len < 1e-6 ? 0 : Math.max(0, L - len - kerf));
// The cut list: pieces [{ id, len }] cut longest first, each from the shortest offcut that holds it, else from a new
// stick (whose rest joins the offcuts). held: offcut lengths already on hand. Returns
// { metres (of new sticks), sticks: [stock length, ...], assign: { [id]: { how: 'offcut' | 'new', stock } }, left: offcuts after, waste }
export function packSticks(pieces, held = [], { stocks = STICK.stocksM, kerf = STICK.kerfM, minKeep = STICK.minKeepM } = {}) {
  // own: the stock length of a stick this plan cuts new (its remainders are not on hand yet), or null for an offcut held now
  const pool = held.map((L) => ({ L, own: null })).sort((a, b) => a.L - b.L), assign = {}, sticks = [];
  let metres = 0, waste = 0;
  const order = pieces.map((p, i) => i).sort((i, j) => pieces[j].len - pieces[i].len || i - j);
  for (const i of order) {
    const p = pieces[i], len = p.len, k = pool.findIndex((o) => o.L >= len - 1e-9);
    let src;
    if (k >= 0) src = pool.splice(k, 1)[0];
    else { const L = stockFor(len, stocks); metres += L; sticks.push(L); src = { L, own: L }; }
    assign[p.id] = { how: src.own === null ? 'offcut' : 'new', stock: src.own === null ? src.L : src.own, from: src.L };
    const rest = restAfter(src.L, len, kerf);
    waste += src.L - len - rest;
    if (rest >= minKeep) { pool.push({ L: Math.round(rest * 1e6) / 1e6, own: src.own }); pool.sort((a, b) => a.L - b.L); }
    else waste += rest;
  }
  return { metres: Math.round(metres * 1e6) / 1e6, sticks, assign, left: pool.map((o) => o.L), waste: Math.round(waste * 1e6) / 1e6 };
}
// "12 x 3.0 m (10 ft), 2 x 4.8 m (16 ft)": a list of stock lengths, counted
export function stickCount(sticks) {
  const n = {};
  for (const L of sticks) n[L] = (n[L] || 0) + 1;
  return Object.keys(n).map(Number).sort((a, b) => a - b).map((L) => ({ lenM: L, n: n[L], ft: STICK.ft[L] || Math.round(L / 0.3048) }));
}

// ---- deliveries
export const DELIVERY = Object.freeze({
  delayS: 3600,                       // an hour of world time: under a minute at normal speed
  // the yard: long things (lumber, boards, sheets) side by side in rows, small things in a band in front of them
  layout: Object.freeze({ mergeR: 14, slot: (i, itemId) => (/^(lumber|board|osb|plywood|gypsum|glulam)_/.test(itemId) ? { x: (i % 4) * 1.5, z: Math.floor(i / 4) * 3.4 } : { x: (i % 5) * 1.15, z: -2.5 - Math.floor(i / 5) * 1.2 }) }),
});

// ---- carrying: by hand about what a person lifts comfortably; a tool that carries more raises it
export const GESTURES = Object.freeze([1, 2, 3, 4]);       // pieces per gesture: one place to read it (setting `gesture`, saved with the world)
export const gestureOf = (options) => (options && Number.isFinite(options.gesture) && options.gesture > 0 ? options.gesture : 3);
// the wheelbarrow: comes with the first delivery; its capacity is this many kg times the armful setting
export const BARROW = Object.freeze({ capKg: 60, reachM: 3, offsetM: 1.5 });
export const CARRY = Object.freeze({ byHandKg: 30, tools: Object.freeze([{ tool: 'wheelbarrow', kg: 60 }]), slow: 0.85 });
export function carryLimitKg(tools = [], gesture = 3) {
  let kg = CARRY.byHandKg;
  for (const t of CARRY.tools) if (tools.includes(t.tool)) kg = Math.max(kg, t.kg);
  return kg * gesture;
}

// ---- how construction feels: every number the hands-on work is tuned by. Saved with the world; the Build panel edits them.
// nails: nails driven per strike (0 = all of the piece's nails). Multipliers: 1 is the default strength.
export const FEEL = Object.freeze({ setCount: 2, nails: 1, strikesPerSec: 3, dropDelayMs: 140, armful: 3, takeM: 4, climbMps: 3.8, learnNeeded: 2, sweepSpeed: 2, hitStop: 1, shake: 1, showLater: 0 });
export const FEEL_SPEC = Object.freeze([
  { key: 'setCount', label: 'Pieces set per click', min: 1, max: 6, step: 1, tip: 'How many pieces one click sets in place, loose, ready to nail' },
  { key: 'nails', label: 'Nails per strike', min: 0, max: 2, step: 1, words: ['all', '1', '2'], tip: 'How many nails one strike of the hammer drives' },
  { key: 'strikesPerSec', label: 'Strikes a second (held)', min: 1, max: 8, step: 0.5, tip: 'How fast the hammer falls while the button is held' },
  { key: 'dropDelayMs', label: 'Delay between pieces (ms)', min: 0, max: 600, step: 20, tip: 'The pause between pieces dropping into place' },
  { key: 'armful', label: 'Armful size (x)', min: 0.5, max: 6, step: 0.5, tip: 'How much you carry at once' },
  { key: 'takeM', label: 'Auto-take from stack (m)', min: 0, max: 12, step: 0.5, tip: 'Within this distance of a stack, pieces come off it without a trip' },
  { key: 'climbMps', label: 'Ladder climb (m/s)', min: 1, max: 8, step: 0.5, tip: 'How fast you climb' },
  { key: 'learnNeeded', label: 'Pieces by hand before learned', min: 0, max: 8, step: 1, tip: 'After this many of a kind by hand, you set and nail it as you sweep along' },
  { key: 'sweepSpeed', label: 'Sweep speed (x)', min: 0.5, max: 5, step: 0.5, tip: 'How fast a learned kind goes in as you sweep' },
  { key: 'hitStop', label: 'Hit-stop (x)', min: 0, max: 3, step: 0.25, tip: 'The tiny freeze on each hit' },
  { key: 'shake', label: 'Shake (x)', min: 0, max: 3, step: 0.25, tip: 'Screen shake on each hit' },
  { key: 'showLater', label: 'Show later stages', min: 0, max: 1, step: 1, words: ['off', 'on'], tip: 'While building, also show the pale blueprint of stages still to come (Plan mode always shows it all)' },
]);
export const FEEL_PRESETS = Object.freeze({
  relaxed: { setCount: 1, nails: 1, strikesPerSec: 2.5, dropDelayMs: 240, armful: 2, takeM: 3, climbMps: 3, learnNeeded: 3, sweepSpeed: 1.5, hitStop: 1.25, shake: 1.25 },
  standard: { ...FEEL },
  fast: { setCount: 4, nails: 0, strikesPerSec: 5, dropDelayMs: 80, armful: 4, takeM: 6, climbMps: 4.5, learnNeeded: 1, sweepSpeed: 3, hitStop: 0.5, shake: 0.5 },
});
export function feelOf(s) {
  const o = { ...FEEL }, f = (s && s.feel) || {};
  for (const sp of FEEL_SPEC) if (Number.isFinite(f[sp.key])) o[sp.key] = Math.max(sp.min, Math.min(sp.max, f[sp.key]));
  return o;
}

// ---- work: blows to put in one member of each kind, and how fast the blows come by the best tool owned
export const WORK = Object.freeze({
  beats: Object.freeze({ site: 8, pier: 3, post: 2, beam: 4, skid: 4, footing: 4, stemwall: 5, slab: 6, joist: 3, plate: 3, stud: 3, header: 4, rafter: 4, sheathing: 4, membrane: 3, cladding: 6, roofing: 4, insulation: 2, lining: 5, door: 6, window: 4, drip: 2, rake: 2, ridgecap: 3, gutter: 3, downspout: 2, guardpost: 2, rail: 3, baluster: 1, stringer: 3, tread: 2, landing: 3 }),
  beatS: 0.33,                        // seconds between blows with a hammer
  tools: Object.freeze([{ tool: 'hammer', speed: 1 }, { tool: 'framing_nailer', speed: 3, power: true }]),
  sound: Object.freeze({ pier: 'scrape', footing: 'scrape', slab: 'scrape', stemwall: 'scrape', site: 'dig', sheathing: 'thunk', membrane: 'rustle', roofing: 'thunk', insulation: 'rustle', door: 'thunk', window: 'thunk', gutter: 'thunk' }),
  // by hand: blows to fasten a piece once it is set in place (stamps for a pier block, strokes of the shovel for the site)
  nails: Object.freeze({ site: 6, pier: 2, post: 1, beam: 2, skid: 2, footing: 2, stemwall: 3, slab: 3, joist: 2, plate: 2, stud: 2, header: 2, rafter: 2, sheathing: 3, membrane: 2, cladding: 3, roofing: 3, insulation: 1, lining: 3, door: 2, window: 2, drip: 2, rake: 2, ridgecap: 2, gutter: 2, downspout: 2, guardpost: 1, rail: 2, baluster: 1, stringer: 2, tread: 2, landing: 2 }),
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
  { when: 'plan:cabin', opens: ['found:piers', 'found:slab', 'plan:larger', 'method:timber-frame', 'fixture:power', 'fixture:water', 'services:in-wall'], says: 'Concrete piers and slabs, larger plans, timber frame, power and water equipment, cable and pipe inside the walls' },
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
    { n: 9, does: 'Roof deck, then dry it in and lay the roofing, standing on the roof', teaches: 'Every layer laps the one below. Dried in: rain now stays outside.', stages: ['roof-deck', 'dry-in', 'roofing'] },
    { n: 10, does: 'Sheathe the walls', teaches: 'Sheets stop the frame swaying.', stages: ['sheathing'] },
    { n: 11, does: 'Wrap the walls, set the window and hang the door', teaches: 'Closing the envelope.', stages: ['wrap', 'openings'] },
    { n: 12, does: 'Put on the siding and hang the gutters', teaches: 'Protecting the wall, and leading the rain away.', stages: ['cladding', 'gutters'] },
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
