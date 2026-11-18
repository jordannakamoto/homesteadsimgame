# Design round, 18 Nov 2026

Three workstreams toward "the full home building experience". Each doc has a summary, the refactor it needs first, interfaces, the player experience and numbered slices (each playtestable on its own).

- `ground-foundations.md`: one ground for every system that cuts and fills (shovel, build site prep, machines), compact earthwork saves, foundations as a real process (layout, dig, base, forms, rebar, pour, cure, strip), the concrete mixer, masonry, and landscaping and farming sharing the same ground and soil.
- `services-roughin.md`: plumbing and electrical as part of construction: one generic run mechanism through the frame, rough-in before insulation, trim-out after lining, two-click routing, drilling and pulling gestures, power reaching tools.
- `vehicles.md`: a controller stack for whatever the player is driving, a generic vehicle core (records, drive model, implements), the ATV and its trailer first, later machines as content.

## Coordination between workstreams
- Save versions: ground A1 and services S4 both want to bump `SAVE_VERSION`. Whoever merges first takes the next number; the other rebases its migration onto the following number. Never renumber a migration already on `main`.
- `window.__build` extension point: the first workstream that needs one lands it in a small, separate commit; the others use it.
- Ground commands (`ground.cut/fill/push/grade/tamp`) are the only way vehicles' implements move earth.
- One barrow: the ground design suggests the vehicles core own a single barrow entity with a tub implement, replacing the construction and landscape barrows. Decide when vehicles V7 lands.
- Under-slab rough-in: services registers what must be in the ground before a pour with `foundation.needRoughIn`.
