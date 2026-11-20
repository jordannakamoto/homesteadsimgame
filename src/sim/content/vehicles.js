// Vehicles for the homestead: the records the generic vehicle mechanism (src/sim/core/vehicles.js) runs on, the items
// the supplier sells for them, and the hooks that pay for fuel and rentals from stock.
// Record fields are described in vehicles-drive.js and ARCHITECTURE.md; local points are [x (right), y (up), z (forward)]
// from the middle between the axles at ground height.

const deg = (d) => (d * Math.PI) / 180;
export const FUEL_ITEM = 'gasoline';

export const VEHICLE_CATEGORIES = Object.freeze([
  { id: 'vehicles', name: 'Vehicles and fuel', blurb: 'Trailers, fuel and fuel cans' },
]);

export const VEHICLE_KINDS = Object.freeze({
  // A utility quad, after a mid-size 4x4 automatic (Honda FourTrax Rancher 420 class; see docs/PLAYTEST.md for the
  // published figures): 2.15 x 1.20 x 1.19 m, 1.295 m wheelbase, 24 in tyres, 292 kg dry of rider, 420 cc single of
  // about 20 kW, five-speed automatic, 14.8 L tank. Walking is 5.4 m/s, sprinting 8.2.
  atv: Object.freeze({
    id: 'atv', name: 'Utility ATV', drive: 'wheeled',
    dims: { l: 2.15, w: 1.2, h: 1.19 }, massKg: 292, cgH: 0.55, clearance: 0.234,
    wheelbase: 1.295, track: 0.95, wheelR: 0.305,
    axles: [{ z: 0.6475, steer: true, driven: true, diff: 'open' }, { z: -0.6475, steer: false, driven: true }],   // front differential, solid rear axle
    powerW: 19800, topMps: 18, reverseMps: 3, brakeG: 0.75, dragK: 0.55,     // 65 km/h governed (see PLAYTEST: streaming)
    engine: {
      idleRpm: 1400, launchRpm: 3200, redRpm: 7000, torqueNm: 32,              // about 20 kW at 6000 rpm
      curve: [[1400, 0.55], [3000, 0.8], [5000, 1], [6500, 0.9], [7200, 0.8]],
      brakeK: 0.6, creepMps: 0.8, creepG: 0.07,
    },
    gears: { ratios: [26, 18.5, 14, 11.5, 9.6], reverse: 30, eff: 0.85, shiftS: 0.3, upRpm: [4300, 6500], downRpm: 2300 },
    // Steering: the mechanical lock (28.5 degrees) at a walk; moving, 23 degrees falling to 9 at top speed. The lock is
    // set from Honda's published 11.5 ft (3.51 m to the outer front tyre) as the model drives it: the solid rear axle
    // scrubs its inner wheel in a tight turn (a moment of about mu x wheel load x track), the front tyres need a few
    // degrees of slip angle to hold against it, so the quad turns as if its wheels pointed about 5 degrees less. The
    // 23 degrees of lock alone turns it 4.5 m.
    steerMaxRad: deg(23), steerRate: 1.6, steerSpeedFalloff: 1 - 9 / 23, steerLockRad: deg(28.5), steerLockMps: 2,
    grip: { mu: 0.65, slide: 0.85, lateral: 8, rolling: 0.045, loadSens: 0.1 }, // knobby tyres on dry grass (lateral: cornering stiffness per unit load, 1/rad)
    susp: { travel: 0.2, hz: 2.0, damp: 0.32 },                               // 185-215 mm of travel; lightly damped, it bobs
    riderKg: 80,
    // The rider shifts their weight as ATV riders are taught: into a turn (upper body to the inside and forward over
    // the bars), the rider's centre of mass moves up to 0.2 m inside and 0.15 m forward as the turn reaches half a g; up
    // a climb (up on the footrests, leaning over the bars), up to 0.3 m forward at 15 degrees and steeper. About 0.3 s
    // to shift. It eases the sideways weight transfer (the tip) and keeps weight on the steered front tyres.
    lean: { inM: 0.2, fwdM: 0.15, g: 0.5, climbM: 0.3, climbRad: deg(15), s: 0.3 },
    seats: [{ id: 'rider', at: [0, 0.886, -0.2], pose: 'straddle', mount: [{ x0: -0.6, x1: 0.4, side: -1 }, { x0: -0.6, x1: 0.4, side: 1 }] }],
    points: [{ id: 'ball', type: 'ball', at: [0, 0.42, -1.12] }, { id: 'front', type: 'front', at: [0, 0.4, 1.1] }],
    hitch: null, cargo: null,
    fuel: { item: FUEL_ITEM, tankL: 14.8, burnLph: 5, pourLps: 0.4 },   // pourLps: a 20 L can poured through its spout, litres a second                       // about three hours flat out
    look: 'atv',
  }),
  // A small utility trailer with a tipping bed, towed on the ATV's ball: an ATV dump trailer of the common steel kind
  // (about 1.8 x 1.1 m bed, 90 kg empty, 350 kg rated, 2-inch ball, 18-22 in tyres). Unbraked, as they are: the ATV's
  // brakes stop both. The empty trailer's centre of mass is 0.165 m ahead of the axle (a tenth of its weight on the
  // ball); a load sits 0.2 m ahead (packed against the front board), so a full trailer puts about 12 percent of its
  // gross on the ball, inside the usual 10-15 percent for utility trailers. A load further back (body.cargoZ) sways.
  // The bed is a manual dump: it pivots just behind the axle, and dry lumber on steel slides once the bed passes about
  // 27 degrees (friction about 0.5).
  trailer_small: Object.freeze({
    id: 'trailer_small', name: 'Small utility trailer', drive: 'towed',
    dims: { l: 2.9, w: 1.3, h: 0.75 }, massKg: 90, cgH: 0.45, cgZ: 0.165,
    wheelbase: 0, track: 1.15, wheelR: 0.25,
    axles: [{ z: 0, steer: false, driven: false }],
    powerW: 0, topMps: 0, reverseMps: 0, brakeG: 0,
    grip: { mu: 0.65, lateral: 12, rolling: 0.035 },
    susp: { travel: 0.1, hz: 2.6, damp: 0.35 },
    seats: [], points: [{ id: 'bed', type: 'bed', at: [0, 0.5, 0] }],
    hitch: { type: 'ball', at: [0, 0.42, 1.65], latchM: 0.4, alignRad: deg(35) },
    cargo: { capKg: 350, bed: { at: [0, 0.5, 0], l: 1.8, w: 1.1, h: 0.3 }, loadZ: 0.2, tips: true,
      pivot: [0.44, -0.3], tipMaxRad: deg(48), tipRadS: deg(30), slideRad: deg(27) },
    fuel: null,
    look: 'trailer_small',
  }),
});

// What the ground does to tyres: multipliers on the record's peak grip (grip.mu, dry grass) and rolling resistance,
// and the sliding grip as a fraction of the peak. Off-road tyre figures: dry grass about 0.65 peak, wet grass 0.4,
// packed dirt 0.7, loose fill and gravel about 0.6, mud 0.3; rolling resistance 0.03 on hard ground to 0.12 in mud.
export const VEHICLE_SURFACES = Object.freeze({
  grass: { mu: 1, slide: 0.85, roll: 1 },
  grass_wet: { mu: 0.6, slide: 0.8, roll: 1.1 },
  dirt: { mu: 1.1, slide: 0.85, roll: 0.75 },
  dirt_loose: { mu: 0.9, slide: 0.85, roll: 1.6 },
  mud: { mu: 0.45, slide: 0.8, roll: 2.6 },
  gravel: { mu: 0.92, slide: 0.85, roll: 1 },
  mulch: { mu: 0.85, slide: 0.85, roll: 1.8 },
  sand: { mu: 0.85, slide: 0.8, roll: 3 },
  snow: { mu: 0.5, slide: 0.8, roll: 1.8 },
  snow_packed: { mu: 0.32, slide: 0.7, roll: 1.1 },
  water: { mu: 0.7, slide: 0.8, roll: 1.8 },
  floor: { mu: 1.2, slide: 0.85, roll: 0.5 },
});

// Implements (blades, mower decks, buckets) come with the later machines.
export const IMPLEMENT_KINDS = Object.freeze({});

// Catalog entries, in the format of src/sim/items.js; merged there like the garden's.
export const ITEMS_VEHICLES = Object.freeze([
  { id: FUEL_ITEM, name: 'Gasoline', category: 'vehicles', unit: 'L', massKg: 0.74, priceUsd: 1, blurb: 'Poured from a fuel can: stand by the ATV and hold R. Its tank holds 14.8 L' },
  { id: 'fuel_can', name: 'Fuel can, 20 L', category: 'tools_hand', unit: 'each', massKg: 1.6, priceUsd: 30, blurb: 'With gasoline in stock, stand by the ATV and hold R to pour' },
  { id: 'trailer_small', name: 'Small utility trailer', category: 'vehicles', unit: 'each', massKg: 90, priceUsd: 450, blurb: 'Delivered to the drop point. Tows behind the ATV: 350 kg on a tipping bed', delivered: true },
]);

// Fuel comes out of stock; rentals are paid from the stock's money (the same direct move construction's rentals make).
export const VEHICLE_HOOKS = Object.freeze({
  takeFuel(ctx, litres, itemId = FUEL_ITEM) {
    const st = ctx.get('stock');
    if (!st) return 0;
    const have = st.items[itemId] || 0, got = Math.round(Math.min(have, litres) * 1e6) / 1e6;
    if (!(got > 0)) return 0;
    const left = Math.round((have - got) * 1e6) / 1e6;
    if (left <= 0) delete st.items[itemId]; else st.items[itemId] = left;
    return got;
  },
  // a bought trailer (or other unit) is handed over from stock as `vehicles.deliver` sets it down
  takeItem(ctx, itemId) {
    const st = ctx.get('stock'), have = st && st.items[itemId] || 0;
    if (!(have >= 1)) return false;
    if (have - 1 <= 0) delete st.items[itemId]; else st.items[itemId] = have - 1;
    return true;
  },
  pay(ctx, usd) {
    const st = ctx.get('stock');
    if (!st || st.money + 1e-9 < usd) return false;
    st.money = Math.round((st.money - usd) * 100) / 100;
    return true;
  },
});
