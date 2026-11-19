// What other systems keep on a building's progress record lives under pr.keep[source] (no system words here).
// What other systems keep on a building lives under pr.keep[source]; setPlan rebuilds the record and carries the bag over as it is,
// so a new source needs no change here. Older saves had ext / extLines / hold on the record itself: moved under keep when first read.
export function keepOf(pr) {
  for (const k of LEGACY_KEEP) if (pr[k] !== undefined) { if (!pr.keep) pr.keep = {}; if (pr.keep[k] === undefined) pr.keep[k] = pr[k]; delete pr[k]; }
  return pr.keep || (pr.keep = {});
}
const LEGACY_KEEP = ['ext', 'extLines', 'hold'];
export function kept(pr, source) { return (pr.keep && pr.keep[source]) || (LEGACY_KEEP.includes(source) && pr[source] !== undefined ? keepOf(pr)[source] : undefined); }
