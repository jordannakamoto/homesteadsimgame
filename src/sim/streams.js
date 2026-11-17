// How much water the streams carry, from the weather: a small catchment water balance, so a dry spell lets the
// brooks shrink to a trickle over weeks, a storm brings them up muddy within hours and they clear and fall back over
// a day or two, and snowmelt swells them in a thaw.
//
// Three stores, in mm of water over the catchment (the lumped "HBV"-style model hydrologists use for small basins,
// cut down to what a game needs):
//   soil   rain and melt soak in; the wetter the soil already is, the more of the next rain runs straight off
//          (runoff fraction = (soil / capacity)^2). Plants draw it down by evapotranspiration, faster when warm.
//   quick  the run-off on its way to the stream: drains in hours (storm flow, which carries the mud).
//   ground the soil slowly recharges it; it drains over weeks (base flow, which keeps a brook running in a drought).
// Stream flow is quick + ground drainage, in mm a day; wetness is that over an ordinary day's flow (1 = ordinary),
// and turbidity follows the storm flow. The renderer turns these into depth, speed and muddiness
// (src/water/rivers-render.js); nothing else reads them yet.
//
// State, at sim.state.sys.streams (plain JSON): { soilMm, quickMm, groundMm, meltSeen, flowMmDay, wetness, turbidity }

const EVERY = 10;                         // ticks (10 minutes), like the weather it follows
const HOUR = 3600, DAY = 86400;
const SOIL_CAP = 120;                     // mm the soil holds before everything runs off
const TAU_QUICK = 8 * HOUR, TAU_GROUND = 25 * DAY;
const PERC_MM_DAY = 2.5;                  // to ground water from full soil
const ET_MM_DAY = 2.2;                    // from wet soil at 15 C
const ORDINARY_MM_DAY = 1.1;              // an ordinary day's stream flow
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function fresh() {
  // start in balance on an ordinary day: ground drainage = ordinary flow
  return { soilMm: 0.55 * SOIL_CAP, quickMm: 0, groundMm: ORDINARY_MM_DAY * (TAU_GROUND / DAY), meltSeen: null, flowMmDay: ORDINARY_MM_DAY, wetness: 1, turbidity: 0.6 };
}

export function stepStreams(s, w, dt) {
  const hours = dt / HOUR, days = dt / DAY;
  // water arriving: rain, and snowmelt (from the weather's running total)
  const meltTotal = w && w.totals ? w.totals.meltMm || 0 : 0;
  const melt = s.meltSeen === null ? 0 : Math.max(0, meltTotal - s.meltSeen);
  s.meltSeen = meltTotal;
  const input = (w ? w.rainMmH || 0 : 0) * hours + melt;
  const frac = Math.pow(clamp(s.soilMm / SOIL_CAP, 0, 1), 2);
  const run = input * frac;
  s.soilMm += input - run;
  if (s.soilMm > SOIL_CAP) { s.quickMm += s.soilMm - SOIL_CAP; s.soilMm = SOIL_CAP; }
  s.quickMm += run;
  // the soil dries: plants (more when warm, none when frozen) and slow percolation down to ground water
  const tC = w ? w.tempC || 0 : 10, sf = s.soilMm / SOIL_CAP;
  const et = Math.min(s.soilMm, ET_MM_DAY * clamp((tC + 2) / 17, 0, 1.6) * Math.min(1, sf * 1.6) * days);
  const perc = Math.min(s.soilMm - et, PERC_MM_DAY * sf * sf * days);
  s.soilMm -= et + perc; s.groundMm += perc;
  // drainage to the stream (exact for a linear store over the step)
  const qOut = s.quickMm * (1 - Math.exp(-dt / TAU_QUICK)), gOut = s.groundMm * (1 - Math.exp(-dt / TAU_GROUND));
  s.quickMm -= qOut; s.groundMm -= gOut;
  const flow = (qOut + gOut) / days;
  s.flowMmDay += (flow - s.flowMmDay) * (1 - Math.exp(-dt / (2 * HOUR)));        // smooth out the 10 minute steps
  s.wetness = clamp(s.flowMmDay / ORDINARY_MM_DAY, 0.05, 12);
  const storm = qOut / days / ORDINARY_MM_DAY;
  s.turbidity += (clamp(0.5 + 0.6 * Math.sqrt(storm), 0.5, 3) - s.turbidity) * (1 - Math.exp(-dt / (storm > s.turbidity ? 1 * HOUR : 10 * HOUR)));
  return s;
}

export const streams = {
  name: 'streams',
  every: EVERY,
  init: () => fresh(),
  step(ctx) { stepStreams(ctx.s, ctx.get('weather'), ctx.dt); },
};

// how the water looks for a given wetness: depth scale (a rating curve, depth ~ flow^0.4) and speed (~ flow^0.3)
export const streamLook = (wet) => ({ depth: clamp(Math.pow(wet, 0.4), 0.3, 1.9), speed: clamp(Math.pow(wet, 0.3), 0.4, 1.8) });
