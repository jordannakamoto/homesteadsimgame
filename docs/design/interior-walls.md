# Interior walls: hanging, taping and trim

Design round, 18 Nov 2026. Workstream 4, after ground, services and vehicles. Painting is out of scope (a later decorating step).

## 10-line summary

1. Inside a framed building, walls and partitions are finished the way a drywall crew and a finish carpenter do it: **hang**, **tape and mud**, then **finish carpentry**. (Not to be confused with services' **Trim-out**, the electrician and plumber fitting devices and fixtures, which already exists and now follows taping.)
2. **Hang** (stage `lining`): drywall sheets 1.2 m tall go on sheet by sheet, the top row first, the bottom row second, end joints staggered and landing on a stud, sheets cut round windows and doors. Each sheet is set and screwed into every stud it crosses. Board lining (tongue and groove pine) goes on a board at a time from the floor up instead, and needs no taping.
3. Interior partitions (walls with floor on both sides, `out = 0`) are lined on **both faces**. Today they get one face.
4. **Tape and mud** (new stage `finish`, drywall only): every seam is taped and given three coats of joint compound, each coat has to dry before the next, then it is sanded flush. Wet mud looks wet; dry mud is lighter; a sanded seam disappears.
5. **Finish carpentry** (later slice, stage `carpentry`): door and window casings with a reveal, then baseboard, cut with miters at the sawhorses (the same cut-on-site mechanic as cripples and rafters). It sits beside services' `trim-out`; with no painting yet, both follow taping.
6. A finished room shows its drywall or boards, not the old plank-and-post voxel faces: build mode draws lining like it draws siding, and the voxel wall body sits behind both.
7. Services (reconciled 18 Nov): the stage order is `rough-in, insulation, lining, finish, trim-out`; `trim-out` needs `finish` (a building without drywall has no seams, so it counts as done). Services checks and opens walls by their lining pieces (any sheet built = covered; opening takes every sheet, seam and batt of the wall), `api.liningCovered(pr, wallId)` is there for a whole-wall check, and boxes are set proud of the studs by the lining's thickness (`frame-channels` `w.finish`) so outlets sit flush with the finished wall.
8. Satisfying beats: a sheet swung up and screwed stud by stud (screws sink with a small dimple), a seam swept with a knife and widening coat by coat, the sanding pass where the joint vanishes.
9. Realism kept honest: ceilings before walls is noted but ceilings stay as they are in V1 (no ceiling drywall slice yet, see open questions).
10. No new full-screen passes, no per-frame allocation; joints draw as one instanced mesh.

## Research notes (what real crews do)

- Hanging order: ceiling first, then the top row of the wall, then the bottom row with a small gap at the floor. Wall sheets hold up the ceiling's edges.
- Sheets go horizontal on walls (fewer and easier joints: one flat seam at chest height), end joints staggered between rows like brickwork, and never lined up with the corners of doors and windows.
- Screws: on studs at 16 in. centres, at most 16 in. apart on walls and 12 in. on ceilings; heads just below the paper, not through it.
- Finishing: tape on every seam and inside corner, metal or paper bead on outside corners, three coats of compound (tape coat, fill coat, finish coat), drying between coats, sanding at the end. That is a "Level 4" finish, what most rooms get before paint. Setting compound can be recoated in about an hour and a half; ordinary premixed takes about a day.
- Partition walls are not load-bearing: a single top plate is enough, studs at 16 in., and blocking where something heavy will hang (cabinets, rails).
- Tongue and groove boards: horizontal from the bottom up with the groove down, blind-nailed through the tongue so no nails show; vertical boards need horizontal blocking between studs.
- Trim: casings first (with a 3/16 in. reveal off the jamb), baseboard after, butting into the casings; miter outside corners, cope inside corners.

## Refactor needed first

- `framing.js`: replace the single `<wall>.ln` lining member per wall with sheets (or board courses) per face. Ids `<wall>.ln<face>.<k>`; faces are `i` (inside of an outside wall) or `a`/`b` (the two faces of a partition).
- `sim/construction.js`: `liningCovered(pr, wallId)` in the system's api; `builtAt` stamped on members when they are built (needed by drying, useful to services and the inspector).

## Data model and interfaces

- Stage `finish` after `lining`: `{ id: 'finish', name: 'Tape and mud', needs: ['lining'] }`. A building without drywall has no `finish` members, so the stage counts as complete (`stageComplete` treats an empty tally as done).
- Joint members: kind `joint`, type `flat` (between rows), `butt` (end joints), `corner` (inside corners). Their line is joint compound; tape is part of the same line's price.
- Coats live on the member in the sim: `m.coat` (0..3 coats, 4 when sanded) and `m.dryAt` (state time when the last coat is dry). The install command applies one pass per call: tape and first coat, second, third, then sanding. A pass on wet mud is refused with `reason: 'wet'` and the seconds left. The member is built after sanding.
- Content: `C.FINISH = { coats: 3, dryS }` (setting compound: about 90 game minutes).
- View: joints are drawn by the construction view in one instanced mesh, width by coat (tape 5 cm, 15 cm, 25 cm), colour by state (paper tape, wet grey, dry off-white). Sanded joints draw nothing: the wall is one surface.

## Player experience

- Hanging: carry sheets, point at a glowing sheet place, click to set it (it swings up from the arms), then screw: one press per stud line, holding sweeps along. The next sheet's place lights up beside it. Rows read like brickwork.
- Taping: point at a seam and press to run the knife along it. The seam widens and goes wet; the next coat can't go on until it dries, so you work round the room and come back. The panel says how long until each is dry.
- Sanding: a last pass over each dry seam: a puff of dust and the seam is gone.
- Boards: like siding inside, from the floor up.

## Slices

1. **Hang the walls** (merged): sheets and board courses per face, both faces of partitions, finished rooms show lining, `liningCovered` and `builtAt` in the sim. Tests: the shed and cabin build end to end; sheet joints land on studs; partitions lined both sides.
2. **Tape and mud** (merged): the `finish` stage, coats with drying, sanding, joint drawing, the guide line for drying.
3. **Finish carpentry**: casings and baseboard cut at the sawhorses with miters (stage `carpentry`, named apart from services' `trim-out`).
4. **Ceilings**: drywall on ceiling joists before walls, a drywall lift as a construction tool.
5. **Blocking and backing**: blocking placed in partitions where the kitchen and shelves will hang (coordinates with the kitchen and furnishing).

## Open questions for the owner

- Should the default cabin lining be drywall (taping game) or pine boards (cabin look)? Today it is boards; the design keeps that and offers drywall in the plan options.
- Ceilings: line the underside of the ceiling joists, or keep vaulted ceilings under the rafters?
