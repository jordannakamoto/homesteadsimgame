# Design round, 18 Nov 2026

Three workstreams toward "the full home building experience". Each doc has a summary, the refactor it needs first, interfaces, the player experience and numbered slices (each playtestable on its own).

- `ground-foundations.md`: one ground for every system that cuts and fills (shovel, build site prep, machines), compact earthwork saves, foundations as a real process (layout, dig, base, forms, rebar, pour, cure, strip), the concrete mixer, masonry, and landscaping and farming sharing the same ground and soil.
- `services-roughin.md`: plumbing and electrical as part of construction: one generic run mechanism through the frame, rough-in before insulation, trim-out after lining, two-click routing, drilling and pulling gestures, power reaching tools.
- `interior-walls.md` (added later the same day): drywall hung sheet by sheet or pine boards course by course, both faces of partitions, tape and mud with drying and sanding (stage `finish`), then trim. Painting is a later decorating step.
- `interior-finishes.md`: paint by surface (walls, a wall face, trim, a single piece; cabinets and furniture join through `PAINTABLE`), primer and two coats by hand with drying (stage `decorate`, "Paint"), then wallpaper. Slice 1 shipped: walls and trim.
- `carpentry.md`: the shared carpentry core (stock, parts with end cuts, joints, finishes) for trim, cabinets and furniture; parts are real members at millimetre precision. Slice 1 shipped: casings and baseboard (stage `carpentry`, before paint). Next: stool and apron, blocking and a workbench, cabinets, a furniture designer that retires the old furniture.
- `vehicles.md`: a controller stack for whatever the player is driving, a generic vehicle core (records, drive model, implements), the ATV and its trailer first, later machines as content.

## Coordination between workstreams
- Save versions: ground A1 and services S4 both want to bump `SAVE_VERSION`. Whoever merges first takes the next number; the other rebases its migration onto the following number. Never renumber a migration already on `main`.
- `window.__build` extension point: the first workstream that needs one lands it in a small, separate commit; the others use it.
- Ground commands (`ground.cut/fill/push/grade/tamp`) are the only way vehicles' implements move earth.
- One barrow: the ground design suggests the vehicles core own a single barrow entity with a tub implement, replacing the construction and landscape barrows. Decide when vehicles V7 lands.
- Under-slab rough-in: services registers what must be in the ground before a pour with `foundation.needRoughIn`.
- Interior walls and services (reconciled 18 Nov): stage order `... gutters, rough-in, insulation, lining, finish, trim-out, services`; `trim-out` needs `finish`. Services checks and opens walls by their lining pieces (`<wall>.ln<face>.<k>`, taped seams `<wall>.jt<face>.<k>`); boxes are set proud of the studs by the lining's thickness so they are flush with the finished wall. The interior "trim" slice is renamed **finish carpentry** (stage `carpentry`: casings, baseboard) so it is not confused with services' Trim-out (devices and fixtures).

## Decisions from the cohesion check (18 Nov 2026, `/designs/cohesion-wave2.md`)

### Save-version ledger
`SAVE_VERSION` on `main` is **3** (v2 packed earthwork grids, v3 moved terrain edits into `sys.ground.macro`). Reserved, in this order, so nobody renumbers a migration already on `main`:

| Version | Slice | What it migrates |
|---|---|---|
| 4 | A5 | the fine 10 cm grid moves from `sys.landscape.grid` to `sys.ground.fine` |
| 5 | S4 | legacy abstract wire and pipe links in build mode become routes |

Nobody else bumps. If you must change a save's shape, ask for the next number; at merge time take the next free number on the newest `main`.

### Other decisions
- **One barrow.** The barrow becomes a vehicles-core unit kind (hand-pushed possession) whose tub holds stacks, bulk m3 or a concrete batch. The construction, landscape and foundation barrow commands become thin shims over it (slice G-2, after G-1, X2 and B-1). The duplicate `wheelbarrow` item (content/construction.js and content/landscape.js) goes with it.
- **X means overlays everywhere.** Unhitching moved to a held prompt at the tongue (hold R, landed with K1). Never put a second job on X.
- **Help is on ? and F1.** H belongs to the Hens. The controls sheet is drawn from the key map `src/game/keymap.js`; when a key moves, move its row.
- The 2/3/4 magic terrain brush is sandbox-only (`localStorage.sandbox = '1'`).
- Kit parts stay the yard and above-ground pipe model; routes are in-building. Hints say so.
- New building elements (decks, porches, lofts, skylights, chimneys) go through the build extension point (`__build.extend`, `__framing.register`), not into `build.js`.
