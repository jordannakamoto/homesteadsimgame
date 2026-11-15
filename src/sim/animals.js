// The individual-animal framework shared by every livestock system (chickens now, goats later).
//
// An individual is plain data: { id, name, sex, bornT, traits }. Its traits carry a small genetic model:
//
//   bv     breeding values of polygenic traits (additive genetic deviations), as fractions of the
//          breed mean (size, lay) or in phenotypic standard deviations (calm, brood, tone).
//   pe     permanent environmental deviations, drawn once at birth (not inherited).
//   genes  Mendelian loci: { locus: [allele, allele] } on autosomes; sex-linked loci (Z in birds,
//          X in mammals) hold one allele in the heterogametic sex (hens, bucks).
//
// Inheritance of polygenic traits follows the infinitesimal model (Fisher 1918; Bulmer 1971):
//   offspring bv = (sire bv + dam bv) / 2 + Mendelian sampling, sampling ~ N(0, sigmaA^2 / 2)
//   with sigmaA^2 = h^2 * sigmaP^2 and no inbreeding correction (the flocks are small and new).
// Mendelian loci pass one randomly chosen allele from each parent; a sex-linked locus passes the
// father's chosen Z (or X) to every chick and the mother's single Z only to her sons
// (in birds the female is ZW, so daughters get their sex-linked allele from the father alone).
//
// Phenotype = breed mean x (1 + bv + pe) for size and lay; the system interprets the others.
// Everything random goes through a seeded stream from ctx.rng, so lineages are reproducible.

import { DAY } from './time.js';

// ---------------------------------------------------------------------------- ids and names
// A seeded id that does not collide with any existing key of `taken`.
export function newId(rng, prefix, taken) {
  for (;;) {
    const id = prefix + Math.floor(rng.float() * 2176782336).toString(36).padStart(6, '0');
    if (!taken || !(id in taken)) return id;
  }
}

// Pick a name from the list that no living animal in `used` (array of names) already has.
// When the list runs out the names come round again with a numeral: "Mabel II".
const ROMAN = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];
export function pickName(rng, list, used) {
  const have = new Set(used);
  for (let round = 0; round < ROMAN.length; round++) {
    const free = list.filter((n) => !have.has(n + ROMAN[round]));
    if (free.length) return rng.pick(free) + ROMAN[round];
  }
  return rng.pick(list) + ' ' + (used.length + 1);
}

// ---------------------------------------------------------------------------- polygenic traits
// trait spec: { h2 (narrow-sense heritability), cv (phenotypic coefficient of variation, or 1 for SD units) }
// sigmaP = cv; sigmaA = sqrt(h2) * sigmaP; sigmaE (permanent environment share) = sqrt(1 - h2) * sigmaP * peShare.
export function sigmaA(spec) { return Math.sqrt(spec.h2) * spec.cv; }
export function sigmaPE(spec) { return Math.sqrt(1 - spec.h2) * spec.cv * (spec.peShare ?? 0.5); }

// Founder (purchased) animals: breeding values drawn around the breed mean.
export function founderTraits(rng, specs, genes) {
  const bv = {}, pe = {};
  for (const k of Object.keys(specs)) {
    bv[k] = rng.normal(0, sigmaA(specs[k]));
    pe[k] = rng.normal(0, sigmaPE(specs[k]));
  }
  return { bv, pe, genes: cloneGenes(genes) };
}

const cloneGenes = (g) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.slice()]));

// Offspring traits from a dam and a sire. `sex` is the offspring's; `sexLinked` lists the loci on the
// sex chromosome; `heteroSex` is the sex with one copy ('hen' in birds).
export function inheritTraits(rng, specs, dam, sire, { sex, sexLinked = [], heteroSex = 'hen' }) {
  const bv = {}, pe = {};
  for (const k of Object.keys(specs)) {
    const mid = ((dam.traits.bv[k] || 0) + (sire.traits.bv[k] || 0)) / 2;
    bv[k] = mid + rng.normal(0, sigmaA(specs[k]) / Math.SQRT2);
    pe[k] = rng.normal(0, sigmaPE(specs[k]));
  }
  const genes = {};
  const loci = new Set([...Object.keys(dam.traits.genes), ...Object.keys(sire.traits.genes)]);
  const homoParent = dam.sex === heteroSex ? sire : dam, heteroParent = dam.sex === heteroSex ? dam : sire;
  for (const L of [...loci].sort()) {
    const d = dam.traits.genes[L], s = sire.traits.genes[L];
    if (!d || !s) { genes[L] = (d || s).slice(); continue; }
    if (sexLinked.includes(L)) {
      const fromHomo = rng.pick(homoParent.traits.genes[L]);
      if (sex === heteroSex) genes[L] = [fromHomo];                       // gets the hetero parent's W (or Y), not its Z
      else genes[L] = [fromHomo, heteroParent.traits.genes[L][0]];
    } else genes[L] = [rng.pick(d), rng.pick(s)];
  }
  return { bv, pe, genes };
}

// Dominance helpers for reading phenotypes from genotypes.
export const hasAllele = (pair, a) => !!pair && pair.includes(a);
export const homozygous = (pair, a) => !!pair && pair.length > 0 && pair.every((x) => x === a);

// ---------------------------------------------------------------------------- age and growth
export const ageDays = (animal, t) => (t - animal.bornT) / DAY;
export const ageWeeks = (animal, t) => ageDays(animal, t) / 7;

// Gompertz growth (Gompertz 1825; standard for poultry growth, e.g. Aggrey 2002, Poultry Science 81):
//   W(t) = A * exp(-exp(-k (t - ti)))      A mature mass (kg), k rate (1/day), ti inflection age (days)
export function gompertz(ageD, A, k, ti) { return A * Math.exp(-Math.exp(-k * (ageD - ti))); }
// dW/dt in kg per day
export function gompertzRate(ageD, A, k, ti) { const e = Math.exp(-k * (ageD - ti)); return A * k * e * Math.exp(-e); }

// ---------------------------------------------------------------------------- energy and water budget
// Metabolisable energy bookkeeping for one animal over a step. All energies in MJ, masses in kg.
//   absorbedMJ   energy absorbed from the gut this step
//   spentMJ      maintenance + production (egg, milk) + activity this step
// Surplus is stored as body tissue at `gainMJperKg` (the ME cost of a kilogram of gain); a deficit is met
// by mobilising tissue that yields `lossMJperKg`. Returns the change in body mass (kg).
// Poultry figures: 5.5 kcal ME per g of gain (NRC 1994 laying-hen equation) = 23 MJ/kg; mobilised hen
// tissue, a mix of fat and lean, yields about 16 MJ/kg of ME.
export function energyBudget(absorbedMJ, spentMJ, gainMJperKg = 23, lossMJperKg = 16) {
  const net = absorbedMJ - spentMJ;
  return net >= 0 ? net / gainMJperKg : net / lossMJperKg;
}

// A water budget: drink what is offered toward need plus any deficit. Returns { drunkL, balanceL }.
// balanceL is the body-water balance against fully hydrated (0 = hydrated, negative = short).
export function waterBudget(balanceL, needL, offeredL) {
  const want = Math.max(0, needL - balanceL);
  const drunkL = Math.min(want, Math.max(0, offeredL));
  return { drunkL, balanceL: Math.min(0, balanceL - needL + drunkL) };
}

// Exponential smoothing toward a target with time constant tau (same units as dt).
export const relax = (x, target, dt, tau) => x + (target - x) * (1 - Math.exp(-dt / tau));
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smoothstep = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
