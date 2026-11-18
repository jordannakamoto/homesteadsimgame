// Cementitious cure, generic (no game words): a cast material that sets on clock time, then gains strength with
// maturity, and can be damaged by freezing while weak or by drying out while young. Plain JSON records, pure functions.
//
// Maturity: Nurse-Saul equivalent age at a 20 C reference with a datum of -10 C (ASTM C1074's time-temperature
// factor): each hour at Tc counts (Tc + 10) / 30 hours at 20 C, and nothing below the datum.
// Strength: ACI 209R form for moist-cured ordinary cement, f(te) = te / (a + b te) of the 28-day strength with a = 4
// days and b = 0.85, which gives about 21% at 1 day, 46% at 3 days, 70% at 7 days and 100% at 28 days and keeps
// rising slowly after. `cap` (1 minus damage) scales it.
// Set: initial set takes `setH20` clock hours at 20 C, doubling for every 10 C colder (halving every 10 C warmer).
// Frost: freezing before the material reaches `frostSafe` of its design strength (ACI 306: about 3.5 MPa) costs up
// to `frostLoss` of its final strength. Drying: evaporation above `evapLimit` kg/m2/h (ACI 305's Menzel nomograph
// formula) in the first `dryWindowH` clock hours, uncovered and not kept wet, costs up to `dryLoss` and crazes the top.
// Rain on the surface before set pits it (cosmetic: `pit`).
//
// record = { t0, ageH, setP, set, eqH, strength, cap, frost, dry, pit, covered, wet, tc }
//   ageH: clock hours since placing; setP: 0..1 toward initial set; eqH: equivalent age in hours at 20 C;
//   strength: fraction of the design strength now; cap: 1 minus damage (frost, drying); covered: null | 'plastic' |
//   'blanket' (or any cover word the content uses); wet: kept wet (misted, ponded); tc: material temperature last step.

export const DEFAULTS = Object.freeze({
  setH20: 2.5,          // clock hours to initial set at 20 C
  datumC: -10,          // Nurse-Saul datum temperature
  refC: 20,             // reference temperature for equivalent age
  a: 4, b: 0.85,        // ACI 209 strength-gain constants (days)
  heatC: 5,             // warmth of hydration above the air while young
  heatH: 24,            // ... for this many equivalent hours
  blanketC: 8,          // extra warmth kept in under an insulating cover while hydration still runs
  blanketH: 72,
  insulating: ['blanket'],
  frostSafe: 0.14,      // 3.5 MPa of 25 MPa
  frostLoss: 0.5,       // cap falls toward 1 - frostLoss
  frostH: 6,            // clock hours of hard frost (-5 C or colder) for full frost damage
  evapLimit: 0.5,       // kg/m2/h: plastic shrinkage cracking risk above this (ACI 305)
  dryWindowH: 24,
  dryLoss: 0.1,
  dryH: 8,              // hours at 1 kg/m2/h above the limit for full drying damage
});
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function newCure(t, o = {}) {
  return { t0: t, ageH: 0, setP: 0, set: false, eqH: 0, strength: 0, cap: 1, frost: 0, dry: 0, pit: 0, covered: null, wet: false, tc: null, setH20: o.setH20 ?? DEFAULTS.setH20 };
}
export const strengthAt = (teDays, k = DEFAULTS) => (teDays > 0 ? teDays / (k.a + k.b * teDays) : 0);
// equivalent hours at the reference temperature per clock hour at tc
export const maturityRate = (tc, k = DEFAULTS) => Math.max(0, (tc - k.datumC) / (k.refC - k.datumC));
// clock hours to initial set at tc
export const setHoursAt = (setH20, tc) => setH20 * Math.pow(2, (20 - clamp(tc, -5, 40)) / 10);
// ACI 305 (Menzel / Uno) evaporation rate, kg/m2/h: concrete tc, air ta (C), relative humidity rh (0..1), wind m/s
export function evaporation(tc, ta, rh, windMs) {
  const V = Math.max(0, windMs) * 3.6;
  return Math.max(0, 5 * (Math.pow(tc + 18, 2.5) - clamp(rh, 0, 1) * Math.pow(ta + 18, 2.5)) * (V + 4) * 1e-6);
}
export function strengthFrac(c, k = DEFAULTS) { return c.cap * strengthAt(c.eqH / 24, k); }
export const workability = (c) => (c.set ? 0 : clamp(1 - c.setP, 0, 1));

// Advance a record. dtH: clock hours (set, weather damage); lifeDtH: hours on the clock that ages things (maturity).
// env: { airC, windMs, rh, rainMmH, covered?, wet? } (covered and wet override the record's when given).
export function stepCure(c, dtH, lifeDtH, env = {}, k = DEFAULTS) {
  if (env.covered !== undefined) c.covered = env.covered;
  if (env.wet !== undefined) c.wet = !!env.wet;
  const air = Number.isFinite(env.airC) ? env.airC : 20;
  let tc = air;
  if (c.eqH < k.heatH) tc += k.heatC;
  if (c.covered && k.insulating.includes(c.covered) && c.eqH < k.blanketH) tc += k.blanketC;
  c.tc = tc;
  c.ageH += dtH;
  if (!c.set) {
    c.setP += dtH / setHoursAt(c.setH20 ?? k.setH20, tc);
    if (c.setP >= 1 - 1e-9) { c.setP = 1; c.set = true; }
    if ((env.rainMmH || 0) > 0.5 && !c.covered) c.pit = clamp(c.pit + (dtH * env.rainMmH) / 10, 0, 1);
  }
  c.eqH += lifeDtH * maturityRate(tc, k);
  // frost: freezing while still weak
  if (tc < 0 && strengthFrac(c, k) < k.frostSafe) c.frost = clamp(c.frost + (dtH * Math.min(1, -tc / 5)) / k.frostH, 0, 1);
  // drying: a young, bare surface in hot, dry, windy air
  if (c.ageH - dtH < k.dryWindowH && !c.covered && !c.wet) {
    const e = evaporation(tc, air, env.rh ?? 0.6, env.windMs ?? 0);
    if (e > k.evapLimit) c.dry = clamp(c.dry + (dtH * (e - k.evapLimit)) / k.dryH, 0, 1);
  }
  c.cap = clamp(1 - k.frostLoss * c.frost - k.dryLoss * c.dry, 0, 1);
  c.strength = strengthFrac(c, k);
  return c;
}
// Jump a record to an equivalent age (tests and sandbox), no damage.
export function ageTo(c, eqH, k = DEFAULTS) { c.eqH = eqH; c.setP = 1; c.set = true; c.strength = strengthFrac(c, k); return c; }
