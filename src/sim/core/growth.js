// Thermal-time plant growth with limiting factors. Generic: it takes plant records as data and knows
// nothing about which plants they are or where they grow.
//
// Development follows thermal time (degree days above a base temperature, flat at an optimum, falling to zero
// at a ceiling), so a cool spring is slow and a warm one fast, and a stressed plant still develops on time.
// Growth (leaf area and dry matter) is light intercepted by the canopy (Beer's law, 1 - exp(-k LAI)) times a
// radiation-use efficiency, scaled by the worst of the limits the caller measures: water, nutrients, light,
// crowding and temperature. A share of new growth goes to the harvested part as the plant develops, so a
// stressed plant matures on time but yields less, as real ones do.
//
// record: { tb, topt, tceil, germMinC, stages: [{ id, gdd }...] (cumulative, first 'sown', then emergence),
//   readyGdd, rue (g DM per MJ intercepted), k, laiMax, partition: { from, to, max, needsDayH? } (fractions of
//   readyGdd), frost: { damageC, killC }, bolt?: { aboveC, index, longDayH }, setLoss?: { aboveC, hoursForNoSet },
//   ripenGdd? (repeat harvests: how long the harvested part takes to ripen), transplant?: { lai, bioG } }
// plant: plain data, see newPlant(). All masses per m2 of the ground the plant covers.

export function thermalRate(T, r) {
  if (T <= r.tb) return 0;
  if (T <= r.topt) return T - r.tb;
  if (T >= r.tceil) return 0;
  return ((r.topt - r.tb) * (r.tceil - T)) / (r.tceil - r.topt);
}
// Temperature factor on growth (0..1): photosynthesis is near its best over a broad band, from about halfway
// between the base and the optimum up to the optimum, and falls to nothing at the base and at the ceiling.
export function growthTemp(T, r) {
  if (T <= r.tb || T >= r.tceil) return 0;
  const lo = r.tb + 0.5 * (r.topt - r.tb);
  if (T < lo) return (T - r.tb) / (lo - r.tb);
  if (T <= r.topt) return 1;
  return (r.tceil - T) / (r.tceil - r.topt);
}
// Degree days over a list of hourly temperatures (each sample stands for `hoursEach` hours).
export function degreeDays(temps, n, r, hoursEach = 1) {
  let s = 0;
  for (let i = 0; i < n; i++) s += thermalRate(temps[i], r);
  return (s * hoursEach) / 24;
}
export function stageIndex(r, gdd) {
  let i = 0;
  while (i + 1 < r.stages.length && gdd >= r.stages[i + 1].gdd) i++;
  return i;
}
// Potential leaf area index at development fraction x (logistic rise to laiMax by about 60% of the way to harvest).
export const laiPotential = (r, x) => r.laiMax / (1 + Math.exp(-11 * (x - 0.32)));
export const interception = (lai, k) => 1 - Math.exp(-k * lai);

export function newPlant(r, t, density = 1) {
  const p = {
    sownT: t, gdd: 0, stage: 0, emerged: false, lai: 0, bio: 0, yieldDM: 0, ripeDM: 0, pickedDM: 0, lostDM: 0,
    health: 1, dead: null, density, bolt: 0, bolted: false, setF: 1, frostBurn: 0, peakLai: 0,
    lim: { water: 1, nutrient: 1, light: 1, crowd: 1, temp: 1 },
  };
  if (r.transplant) { p.emerged = true; p.lai = r.transplant.lai; p.bio = r.transplant.bioG; p.stage = 1; }
  return p;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Advance one plant by one step.
// env: { days, temps: [hourly air C], n, soilC (seed-zone temperature), topWet (0..1 water in the seed zone),
//        minC (the coldest the plant felt), rsMJ (global solar reaching the canopy over the step, per m2),
//        dayH (day length), water (Ks 0..1), nutrient (0..1), light (0..1, already in rsMJ: for reporting),
//        competition (0..1: share of light weeds leave) }
// Returns dBio (g DM per m2 grown this step; 0 when nothing grew). Sets plant.events bit flags in `ev`.
export const EV_EMERGED = 1, EV_STAGE = 2, EV_FROST = 4, EV_KILLED = 8, EV_BOLTED = 16;
export function advance(p, r, env, ev = { flags: 0 }) {
  ev.flags = 0;
  if (p.dead) return 0;
  // development
  if (!p.emerged) {
    // germination: on soil temperature, and only while the seed zone is moist
    const dd = env.soilC > r.germMinC && env.topWet > 0.35 ? thermalRate(env.soilC, r) * env.days : 0;
    p.gdd += dd;
    if (p.gdd >= r.stages[1].gdd) { p.emerged = true; p.lai = Math.max(p.lai, 0.01 * p.density); p.bio = Math.max(p.bio, 1.5 * p.density); ev.flags |= EV_EMERGED; }
  } else p.gdd += degreeDays(env.temps, env.n, r, (env.days * 24) / Math.max(1, env.n));
  const st = stageIndex(r, p.gdd);
  if (st !== p.stage) { p.stage = st; ev.flags |= EV_STAGE; }
  // frost: only what is above ground can freeze
  p.frostBurn = Math.max(0, p.frostBurn - env.days / 10);
  if (p.emerged && env.minC < r.frost.damageC) {
    if (env.minC <= r.frost.killC) { p.dead = 'frost'; p.lai = 0; ev.flags |= EV_KILLED | EV_FROST; return 0; }
    const f = (r.frost.damageC - env.minC) / (r.frost.damageC - r.frost.killC);
    p.lai *= 1 - 0.7 * f; p.health = Math.max(0.05, p.health - 0.4 * f); p.frostBurn = Math.max(p.frostBurn, f); ev.flags |= EV_FROST;
  }
  if (!p.emerged) return 0;
  const x = p.gdd / r.readyGdd;
  // heat: premature flowering (bolting) and lost fruit set
  if (r.bolt && !p.bolted && x > 0.3) {
    let hot = 0; for (let i = 0; i < env.n; i++) hot += Math.max(0, env.temps[i] - r.bolt.aboveC);
    p.bolt += (hot * env.days * (env.dayH >= r.bolt.longDayH ? 1.3 : 1)) / Math.max(1, env.n);
    if (p.bolt >= r.bolt.index) { p.bolted = true; ev.flags |= EV_BOLTED; }
  }
  if (r.setLoss && x > 0.3) {
    let h = 0; for (let i = 0; i < env.n; i++) if (env.temps[i] > r.setLoss.aboveC) h++;
    const hotPerDay = (h * (env.days * 24) / Math.max(1, env.n)) / env.days;
    const target = clamp(1 - hotPerDay / r.setLoss.hoursForNoSet, 0, 1);
    p.setF += (target - p.setF) * (1 - Math.exp(-env.days / 5));
  }
  // limits
  let tf = 0; for (let i = 0; i < env.n; i++) tf += growthTemp(env.temps[i], r);
  tf /= Math.max(1, env.n);
  const crowd = 1 / (1 + 0.5 * Math.max(0, p.density - 1));
  const L = p.lim;
  L.water = env.water; L.nutrient = env.nutrient; L.light = env.light; L.crowd = crowd; L.temp = tf; L.weeds = env.competition;
  const g = Math.min(env.water, env.nutrient) * p.health;
  // canopy: follows its potential (more plants per m2 make more leaf, with diminishing returns), held back by stress
  const past = x > r.stages[r.stages.length - 1].gdd / r.readyGdd;
  const target = laiPotential(r, Math.min(x, 1)) * Math.pow(p.density, 0.35) * p.health * (past ? 0.5 : 1);
  if (target > p.lai) p.lai += (target - p.lai) * clamp(degreeDays(env.temps, env.n, r, (env.days * 24) / Math.max(1, env.n)) / 60, 0, 1) * g;
  else p.lai += (target - p.lai) * clamp(env.days / 20, 0, 1);
  p.peakLai = Math.max(p.peakLai, p.lai);
  // dry matter from intercepted light
  const dBio = r.rue * env.rsMJ * env.competition * interception(p.lai, r.k) * tf * g;
  p.bio += dBio;
  // the harvested part
  const pr = r.partition;
  let share = pr.max * clamp((x - pr.from) / Math.max(1e-6, pr.to - pr.from), 0, 1);
  if (pr.needsDayH && env.dayH < pr.needsDayH && x < 1) share = 0;
  if (r.bolt && p.bolted) share *= 0.2;
  if (r.setLoss) share *= p.setF;
  share *= crowd;
  p.yieldDM += dBio * share;
  // repeat harvests ripen behind the growth, and ripe produce left on the plant spoils
  if (r.ripenGdd && x >= 1) {
    const dd = degreeDays(env.temps, env.n, r, (env.days * 24) / Math.max(1, env.n));
    const unripe = p.yieldDM - p.ripeDM;
    p.ripeDM += unripe * clamp(dd / r.ripenGdd, 0, 1);
    const hang = p.ripeDM - p.pickedDM - p.lostDM;
    if (hang > 0) p.lostDM += hang * clamp(env.days / 20, 0, 1);
  }
  return dBio;
}
