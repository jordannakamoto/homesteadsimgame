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
  // A utility quad: gets you around the land, tows the trailer. Walking is 5.4 m/s, sprinting 8.2.
  atv: Object.freeze({
    id: 'atv', name: 'Utility ATV', drive: 'wheeled',
    dims: { l: 2.1, w: 1.2, h: 1.15 }, massKg: 320, cgH: 0.55,
    wheelbase: 1.28, track: 0.95, wheelR: 0.3,
    axles: [{ z: 0.64, steer: true, driven: true }, { z: -0.64, steer: false, driven: true }],
    powerW: 24000, topMps: 11, reverseMps: 3, brakeG: 0.7,
    steerMaxRad: deg(32), steerRate: 2.5, steerSpeedFalloff: 1 - 12 / 32,    // 32 degrees at a crawl, 12 at top speed
    grip: { mu: 0.9, lateral: 9, rolling: 0.03 },
    susp: { travel: 0.18, hz: 2.2, damp: 0.3 },                               // lightly damped: it should bob
    seats: [{ id: 'rider', at: [0, 0.85, -0.15], pose: 'straddle', mount: [{ x0: -0.55, x1: 0.45, side: -1 }, { x0: -0.55, x1: 0.45, side: 1 }] }],
    points: [{ id: 'ball', type: 'ball', at: [0, 0.42, -1.12] }, { id: 'front', type: 'front', at: [0, 0.4, 1.1] }],
    hitch: null, cargo: null,
    fuel: { item: FUEL_ITEM, tankL: 14, burnLph: 5 },                         // about three hours of real driving
    look: 'atv',
  }),
  // A small utility trailer with a tipping bed, towed on the ATV's ball.
  trailer_small: Object.freeze({
    id: 'trailer_small', name: 'Small utility trailer', drive: 'towed',
    dims: { l: 2.9, w: 1.3, h: 0.75 }, massKg: 90, cgH: 0.45,
    wheelbase: 0, track: 1.15, wheelR: 0.25,
    axles: [{ z: 0, steer: false, driven: false }],
    powerW: 0, topMps: 0, reverseMps: 0, brakeG: 0,
    grip: { mu: 0.9, lateral: 12, rolling: 0.02 },
    susp: { travel: 0.1, hz: 2.6, damp: 0.35 },
    seats: [], points: [{ id: 'bed', type: 'bed', at: [0, 0.5, 0] }],
    hitch: { type: 'ball', at: [0, 0.42, 1.65] },
    cargo: { capKg: 350, bed: { at: [0, 0.5, 0], l: 1.8, w: 1.1, h: 0.3 }, tips: true },
    fuel: null,
    look: 'trailer_small',
  }),
});

// Implements (blades, mower decks, buckets) come with the later machines.
export const IMPLEMENT_KINDS = Object.freeze({});

// Catalog entries, in the format of src/sim/items.js; merged there like the garden's.
export const ITEMS_VEHICLES = Object.freeze([
  { id: FUEL_ITEM, name: 'Gasoline', category: 'vehicles', unit: 'L', massKg: 0.74, priceUsd: 1, blurb: 'Sold in 20 L cans. The ATV holds 14 L' },
  { id: 'fuel_can', name: 'Fuel can, 20 L', category: 'tools_hand', unit: 'each', massKg: 1.6, priceUsd: 30, blurb: 'Carry it to the ATV and pour' },
  { id: 'trailer_small', name: 'Small utility trailer', category: 'vehicles', unit: 'each', massKg: 90, priceUsd: 450, blurb: 'Tows behind the ATV. 350 kg on a tipping bed' },
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
  pay(ctx, usd) {
    const st = ctx.get('stock');
    if (!st || st.money + 1e-9 < usd) return false;
    st.money = Math.round((st.money - usd) * 100) / 100;
    return true;
  },
});
