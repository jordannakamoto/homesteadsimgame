# Plan mode and the door and window designer: redesign

Plan for the `ui-redesign` branch. It also covers the stairs tool (section 3A) and what plan mode shows (section 3B). Implementers: read this, `CLAUDE.md`, and sections 1, 2 and 4.2 of `docs/design/ui-redesign.md` (tokens, kit classes, `window.__ui`). Rules that bind every step: 144 fps (no per-frame JS added to the UI, no new full-screen pass), kit classes and tokens only (no literal colours; instruments keep `--cad`, `--cad-ink`, `--cad-bg` in both skins), `buildui.js` draws only what `__build.view()` describes and reports through `__build.choose()`, letter keys stay as they are, nothing in `src/sim/` changes except `src/sim/content/openings.js` and the new `src/sim/content/stairs.js`.

Screenshots of today's build mode (1440x900, Cozy, sandbox) are in `/tmp/FAB/shots/`; the script that made them is `/tmp/FAB/shots.mjs` (run from `/tmp/FAB`, same loader as `test/build.smoke.mjs`).

## 1. Diagnosis

Measured on the built page.

| # | Problem | Evidence |
|---|---|---|
| D1 | The bar eats the view. | `#buildbar` is 225 px tall on Select, 292 px on Wall, 359 px on Room, 363 px with a wall selected (of 900). `02-room-tool.png`, `11-select-wall-inspector.png`. |
| D2 | The options strip mixes "what I am drawing" with the building's make-up. | Room shows 13 groups in three rows: shape, walls, floor, Paint, Pick, ceiling, raise, split level, foundation, insulation, lining, wall paint, trim. Only the first three change what the drag draws. |
| D3 | Too many equal buttons in one row. | 14 tools + Snap, storey stepper, List, Free, Undo, Redo, Done = 21 controls. Two more tools are hidden inside others (round room in Room's Shape, Copy in Select). `Free` is the old wood-cost switch from before construction existed; `List` does not say what it lists. |
| D4 | Three places to look, and they move. | Hint pill, options strip, side panel. A selected window has its type and Flip/Delete in the strip, its size and look in the side panel, and its handles on the wall. `08-window-selected.png`. |
| D5 | The designer does not fit its panel. | `#bdesign` is 472 px tall; its content is 958 px (door), 1273-1302 px (window). Preview and Size fill the visible part; style, glass, sidelights, colour and handle are below the fold. On a phone it is 321 px tall, covers the top HUD and cuts the preview. `05-door-tool-designer.png`, `p03-phone-window.png`. |
| D6 | Types are unlabelled 19 px icons. | 20 window icons and 15 door icons in a row; the name shows only on hover, never on touch. |
| D7 | Doors are behind windows. | No preview drawing for doors. No control of which way a door opens beyond one `Flip` with no picture. Patio, barn, pocket, bifold and garage doors have size only: no colour, no panels, no glass. |
| D8 | Two ways to select, with different results. | A door or window can be edited only with its own tool in hand (`B.fsel`). The Select tool gives a different inspector with the three rustic types. |
| D9 | The hint that explains a tool is replaced the moment it is needed. | Over any room every tool's hint becomes "Room 6 x 4 m · 24 m² · walled in, no roof yet" (`05` to `10`). The door and window hints are 45-word sentences; on a phone they truncate. |
| D10 | Dimension chips pile up. | A selected window shows six chips inside 80 px, overlapping each other and the handles. `08-window-selected.png`, `09-gothic-tall.png`. |
| D11 | Size changes fail from the wrong edge. | Height grows from the sill up, so a tall or arched unit hits the top plate and is refused ("Won't fit: too tall for this wall") even when it would fit lower. Selected windows already drop their sill; new ones and doors with a transom do not, and the player is not told what to change. |
| D12 | Storeys and roofs are opaque. | A stepper that says "Ground" with no sign of which storeys exist; "Show roofs" lives only in Select's options. |
| D13 | What happens after planning is not said. | The only link to construction is a chip in the top-left corner ("Sandbox: built at once" / "Plans are raised by hand"). Done just closes. |

## 2. The new model in one picture

```
desktop                                                         +- inspector (#bdesign) -+
                                                                | icon  Next window    x |
   world: ghost, --cad dimensions, handles                      | [ stage: unit on wall ]|
                                                                | Fits · store size $235 |
                                                                | Size & place|Style|Fin.|
 (1 Room)(2 Door)(3 Roof)(4 Done)  Drag out a room.   [acts]    | ...                    |
+-- tray (#bopts): one row of named cards -------------[More]-+ +------------------------+
+--------------------------------------------------------------------------------------+
|[Select][Room][Wall][Roof][Door][Window][More^][Inside^][Remove] | undo redo snap      |
|                                              [Cellar|Ground|2|+][roofs] [Materials $] [Done]|
+--------------------------------------------------------------------------------------+
```

Three surfaces, each with one job:

1. **Bar** (what tool): one row, always the same.
2. **Tray** (what kind): one row above the bar, never wraps. Only the choices that change what the next click draws, as named cards and swatches.
3. **Inspector** (every property, exact numbers): one right-hand drawer. It is the same drawer for "the next thing" and "the selected thing", and it is the door and window designer. Closed by default except for Door and Window; a player who never opens it can still plan a house.

Bar height becomes about 150 px on every tool (bar 72 + tray 76), against 225-363 px now.

### 2.1 Bar

- Nine slots in `#bpieces`: Select (V), Room (R), Wall (N), Roof (O), Door (J), Window (U), **More** (Floor F, Stairs Z, Pillar P, Path L, Measure Y), **Inside** (Furnish C, Equip E), Remove (X).
- A group slot works like a tool group in Flash: it shows its last-used member's icon and name with a corner caret; one click picks that member, a click on the pressed slot (or a long press) opens a flyout `#bfly` of large named tiles. Letters pick any member directly and never open the flyout.
- Round room stays in Room's tray (Box / Round). Copy stays a selection action.
- Right cluster: Undo, Redo, Snap, storeys, Materials, Done. `Free` and the Options fold button are removed from the page (`choose('free')` and `choose('fold')` stay as no-op-safe ids).
- Digit keys keep working as today but are not shown; one keycap per slot (the letter).

### 2.2 Tray

`#bopts` shows the groups marked `tier: 1`, at most four, in one row that scrolls sideways if it must. At its right end: Paint and Pick as icon buttons (only when the tray has a swatch group), then `#bmore` "More" which opens the inspector. `#bdecor` stays as the second row for Furnish and Equip only.

| Tool | Tray (tier 1) | Inspector sections |
|---|---|---|
| Room | Shape, Walls, Floor (Round: + Storeys) | Level: Ceiling, Raise, Split level. Construction: Stands on, Insulation, Inside. Finish: wall paint, sheen, trim |
| Wall | Style (named cards: Wall, Arch, Pointed, Braced, Fence), Material | Level: Height, Raise, Split level |
| Floor | Surface | Level; Construction |
| Roof | Shape (+ Turn), Roofing (one group, Classic then Modern), Roof the building | Pitch, Overhang, Finish, On a round room (as now) |
| Door, Window | Recent, then family tabs with type cards (section 3.2) | The designer (section 3) |
| Stairs | Type cards (Auto, Steps, Straight, L, U, Winder, Spiral, Ship's ladder), Material | Section 3A |
| Pillar / Path | Kind, Material / Width, Surface | none |
| Select, nothing selected | Info: "Everything built ..." | none |
| Select, selection | Info (name, measures), Style or Material, Length (walls) | everything else `selGroups` emits today |

### 2.3 Selecting and editing

- Select is the home tool. Click selects, drag moves, edge handles resize (walls and openings), Delete removes: unchanged.
- **One way to edit an opening.** Clicking a door or window with Select picks up the Door or Window tool with that unit selected (`B.fsel`), which opens the designer on it. Esc returns to Select. The `s:otype` group goes away for free openings (it stays for rustic module pieces).
- Double-click any piece, or `#bmore`, opens the inspector on it. The inspector stays open or closed as the player left it (`B.insp`, saved in `localStorage['build:insp']`), except Door and Window always open it.
- Selection actions (`#bacts`: Whole building, More like this, Copy, Flip, Delete) stay at the right of the hint row.

### 2.4 Hint row and first run

- One sentence per tool, at most 70 characters, verb first. Examples: Room "Drag out a room. Type a number for an exact size." Door "Click a wall to hang the door. Drag it to slide." Window "Click a wall to place the window. Drag an edge to resize." Longer detail goes in the slot's `title`.
- The tool's hint is not replaced by room facts. Room facts ("walled in, no roof yet") become the tray's info group for Roof and Select.
- **Coach chips**, no help panel: until the first building has a room, a door and a roof, the left of the hint row shows four chips: `1 Room`, `2 Door`, `3 Roof`, `4 Done`. Finished ones tick, the next one pulses (CSS, `opacity`/`transform` only), clicking one picks its tool. After the first time through they never show again (`localStorage['build:coached']`).

### 2.5 Precision

- Dimension chips, snap marker, typed sizes and handles work as now and keep the `--cad` look.
- De-clutter rule for a selected opening: width and height chips always; the gaps to neighbours and the sill chip only while it is being dragged or resized. Exact position is in the designer.
- Snap stays one toggle. Ctrl still places freely.

### 2.6 Storeys

- `#blevel` becomes a `.ui-seg` of chips: the storeys that exist (`Cellar`, `Ground`, `2`, `3`) plus one empty chip above the top one (`+`). Cellar shows dim until one is dug. Page Up / Page Down unchanged.
- Next to it a `Roofs` eye toggle (`#broofs`, `choose('roofs')`), for every tool. Step V2 later replaces it with the view control of section 3B.
- Ceiling height, Raise and Split level are the inspector's Level section. This is where great halls, cellars and half-levels are set; nothing about them is on the bar.

### 2.7 From plan to building

- `#bsched` is labelled **Materials** and, when sandbox is off, carries the total (`$1,240`). Its panel (`#bschedp`) gets a kit head and a footer: sandbox off, a `.ui-btn--go` "Order materials" that leaves plan mode and opens the Build panel (click `#cvb`); sandbox on, one line "Sandbox: built as you draw".
- Leaving with unbuilt plan pieces and sandbox off shows one toast: "Plan saved: N pieces to build. Open Build (L) to order materials."
- The plan book, the tutorial shed and `placePlan` are untouched: a placed plan is edited with the same tools.

### 2.8 Phone (`body.touch`)

- Bar: the nine slots in one side-scrolling row; Undo and Done pinned at the right; Redo, Snap, storeys, Roofs and Materials behind a `...` button that opens them as a small sheet.
- Flyouts and the tray are single rows of 56 px cards.
- Inspector and designer are a bottom sheet with two heights: **peek** (the stage and the fit line, about 190 px; the wall stays visible above it and `B.barH` includes it so the view frames the wall) and **full** (72vh). It starts under the top HUD, never over it. Sticks hide while the sheet is up (`body.ui-sheet`).
- Handles on the wall and in the stage have 44 px hit areas.

## 3. The opening designer

One designer for doors and windows, in the inspector drawer. Door and Window stay separate tools; they share the drawer, the stage, the fit line and the tabs.

### 3.1 Layout (380 px drawer on desktop)

1. **Head**: icon, "Next window" or "Selected door", type name as subtitle, close.
2. **Stage** (sticky, 220 px, `--cad-bg` in both skins): the unit drawn to scale on its real wall run: floor line, top plate, wall ends, neighbouring openings in outline, `--cad` dimension lines for width, height, sill or head, and the gap to each side. With no wall under the pointer it uses a 4 m wall at the current ceiling height. Windows and doors use the same drawing code (section 4, `opening-preview.js`).
   - Direct manipulation in the stage: drag the left, right and top edges (and the sill for windows) to resize; drag the body to move it along the wall (windows: up and down too). Same rules, snaps and 5 cm steps as the handles on the wall; both stay in step because both go through `choose`.
   - Doors: a small plan view under the elevation (wall line, leaf, swing arc). Its four quadrants are four buttons: hinge left or right, opens in or out. The pressed one is drawn solid. Sliding kinds show which way the panel travels; the two halves are the buttons.
3. **Fit line**: always one row. Good: "Fits · store size · $235". Bad: what is wrong with a number, then one or two fix buttons, for example "0.12 m too tall for this wall" `[Lower the sill to 0.24]` `[Make it 2.28 high]`; "Overlaps the door beside it" `[Slide left 0.30]`; "Round walls take the rustic styles" `[Show rustic]`.
4. **Tabs** (`.ui-tabs`): Size & place, Style, Finish.
5. **Foot**: Selected: Flip (F), Delete. Next: "Click a wall to place it".

| Tab | Windows | Doors |
|---|---|---|
| Size & place | Width, Height (steppers, typed). Store sizes. **Height on the wall**: anchor Sill / Head / Centre with its number, and presets Standard 0.90, Counter 1.07, Low 0.45, High 1.50, Floor 0.10, Door head 2.03. **Along the wall**: distance from the left end, and Centre on wall, Centre between, Equal spacing | Width, Height, Store sizes. Along the wall (same). Opens: the plan-view buttons repeated as a labelled row for keyboards |
| Style | Whole look (picture cards), Shape, Grille and bar counts, Panes across and high | Hinged: Panels, Glass, Bars, Sidelights, Transom. Sliding, folding, barn, pocket: Panels or leaves, Glass, Bars (what the mesh supports, see P6) |
| Finish | Frame colour. "Shutters are hung later, in Furnish" (one line, no control) | Colour, Handle, Metal, As sold |

### 3.2 Catalogue in the tray

- First group **Recent**: the last four designs placed with this tool (type, size, look, finish), as cards. `localStorage['build:od:recent:window' | ':door']`.
- Then `.ui-tabs` by family and one row of cards, each a 56 px drawing of the type made by the same preview code, with its name under it.
  - Windows: Classic, Modern, Rustic ("for angled and round walls").
  - Doors: Entry, Interior, Patio and sliding, Utility, Rustic.
- What the sim catalogue has today: 17 window types (12 classic, 5 modern including the full-height glass panel and the glass wall) and 13 door types (8 hinged or pivot, patio slider, barn, pocket, bifold, garage).
- Cheap additions, data only (they are presets of looks the meshes already draw): `casement_pair` (casement, two lites across), `picture_trio` (picture, three lites), `door_cottage` (plank, top lite, knob), `door_modern` (flush, slot glass, long pull, black), `door_entry_double` (two leaves, six-panel, for sidelights). One addition with a little mesh work: `door_cased` (a cased opening with no leaf), in P6.

### 3.3 Rules that fix the old complaints

- **Nothing is refused silently.** A change that does not fit is applied as far as it can be, in this order: slide the free edge (a window's sill goes down to 0.10 m, a unit slides along the wall), then clamp the size. The fit line says what was done and offers the other choice. This is the arched-window fix: a taller or arched unit lowers its sill instead of failing at the top plate.
- **The anchor is the player's choice.** With anchor Head, changing the height moves the sill; with Sill it moves the head. A new window whose head lands within 0.15 m of a neighbour's head or of 2.03 m starts anchored to the head.
- **Which way it opens is drawn**, in the plan view and as a faint arc on the floor under the ghost and under the selected door.
- **Glass** stays the engine's glass material (world art, not skinned). No shutters in the designer.

## 3A. Stairs

### 3A.1 Today

- One stair: straight, always a whole storey high, one grid cell (1 m) wide, `stairLen(hs) = max(3, round(3 x hs))` metres long with four steps a metre. On a normal 2.84 m storey that is 12 risers of 237 mm on 250 mm treads: steeper than a house stair.
- Saved as `{ id, i, j, dir }` in `S.stairs`. Drawn by `stairPieces` (`src/build.js` 2205-2231) as solid boxes from each step down to the floor, with a rail on three posts each side.
- The floor above is opened automatically over it (`wellOver`, 2182), the player walks it as a ramp (`stairH`, 2193, used at 10904), and it is one piece of kind `stair`, type `straight`, material `timber` (10599-10605) that `src/sim/structure.js` loads onto the floor.
- Round rooms at least 1.7 m inside get a spiral automatically (`climbLevels`, 1226); it cannot be placed anywhere else.
- Nothing joins a split level, a raised floor, a porch or a cellar to the level beside it. The tool refuses to start anywhere but on a floor ("Stairs start on a floor"), and its only option is Turn.

### 3A.2 Types

| Type | What it is | Rule of thumb used |
|---|---|---|
| Steps | 1 to 3 risers for a small change of level: sunken room, raised nook, split level, threshold | Rise up to 0.6 m; no rail by default under 0.6 m |
| Straight | One flight | Riser 150-190 mm (aim 178), tread 250-280 mm, 2R + T between 600 and 640 mm, at most 16 risers in a flight |
| L | Two flights and a square landing, turning left or right | Landing as deep as the stair is wide; the turn can sit anywhere along the rise |
| U | Two flights side by side and a half landing | Needs twice the width plus 0.1 m |
| Winder | An L with three wedge treads in place of the landing | Saves about 0.9 m of run; treads 250 mm at the walking line |
| Spiral | Treads round a centre post | Diameter 1.5 m or more, 30 degrees a tread, riser up to 220 mm, 2.0 m headroom under the tread above |
| Ship's ladder | Very steep stair with handrails | 60-70 degrees, riser 230 mm, for lofts and cellars where nothing else fits |
| Deck steps | Straight or Steps with open risers on cut stringers, foot on the ground | Same riser rule; the foot may stand on terrain |

All take a width (0.8, 0.92, 1.07, 1.2 m or typed; Steps up to 3 m for a porch) and may start on the ground when the top lands on a floor's edge.

### 3A.3 Placing: drag from low to high

1. Press at the foot and drag to where the stair should arrive. The rise is the height between the two surfaces under the pointer: a floor and the storey above it, a floor and a raised or split-level floor beside it, the ground and a porch or deck, a cellar floor and the ground floor. Dragging across one floor means "up to the next storey".
2. The run is the drag length, shortened by walls and floor edges in the way.
3. With **Auto** in hand the tool picks the type and step count:
   - rise up to 0.6 m: Steps;
   - the run fits a comfortable straight flight: Straight;
   - not enough run but room to the side: L (the side the pointer bends toward), or U when there is two widths of room;
   - a clear square of 1.6 m or more and nothing longer: Spiral;
   - otherwise Ship's ladder.
   The ghost shows the stair, the opening it will cut in the floor above, and `--cad` chips for the rise, the run and "14 x 178 mm". A type picked in the tray overrides Auto until Auto is picked again; Shift wheel or the comma and full-stop keys step through the types that fit.
4. Release to place. Typed numbers while dragging set the run, as for walls.

Nothing is refused silently (the rule of 3.3). If the chosen type does not fit, the ghost is drawn as close as it can be and `view().fit` says why with fixes, for example: "Too steep: 12 risers of 237 mm in 3.0 m" `[Make it L-shaped]` `[Lengthen to 3.6 m]` `[Use a spiral]`; "Head hits the floor above: 1.74 m of headroom" `[Lengthen the opening]`; "Lands 0.4 m past the floor's edge" `[Shorten to 13 risers]`.

A selected stair has handles at its foot and its head (drag to re-fit: the step count is solved again) and, for L, U and winder, one on the landing. The inspector shows a side view with riser and tread sizes.

### 3A.4 Tray and inspector

- Tray: Type cards (drawn by the stair module at thumb size, named), Material (Pine, Oak, Dark stain, Painted white with wood treads; Stone for Steps and Deck steps outdoors).
- Inspector sections. **Size**: Width, Risers (stepper; shows riser and tread), Turn (left / right), Landing after riser N. **Railing**: Both, Left, Right, None, Against a wall (auto when a wall runs beside it); style Square balusters, Horizontal rails, Plain handrail. **Treads**: Closed or Open risers, Nosing on or off. **Under it**: Open or Boxed in (a closet under the stair; boxed is the look only).

### 3A.5 Geometry: carpentry, cheap

- Built as real parts, not stacked blocks: two cut stringers on the slope, treads 40 mm thick with a 25 mm nosing, risers 20 mm (or none), newel posts 90 mm at the foot, head and every turn, a sloped handrail at 0.9 m, balusters at 110 mm centres or three horizontal rails, landings as a framed platform on four posts. Spiral: a 100 mm centre post, treads as tapered boards (each two boxes, narrow and wide), a baluster at each tread's outer end and a handrail of short straight pieces along the helix.
- Parts are returned as plain lists of boxes (`abox`) and slanted boxes (`obox`) and go into the building's merged mesh through the existing `g.abox` / `g.obox`, like every other piece. No new materials, no instancing needed, nothing per frame. A 14-riser straight stair with balusters is about 60 boxes; a spiral about 90.
- Walking stays a height function: a ramp per flight, flat on landings, by angle on a spiral.

### 3A.6 Data

- A stair record gains optional fields; old `{ id, i, j, dir }` records load as a straight stair to the storey above, 0.92 m wide, and look like a proper stair straight away.
  `{ id, type, x, z, dir, rise, run, width, n, turn, at, mat, rail, railStyle, open, nosing, boxed }`: `x`, `z` in the building's own metres (the foot's centre), `rise` in metres, `n` risers, `at` the riser the landing follows.
- The piece keeps `kind: 'stair'`, `a`, `b`, `y0`, `y1`, `length`, `height`, `width`, `steps` (what `src/sim/structure.js` reads) and adds `type`, `riser`, `tread`, `footprint`.
- `wellOver` opens the floor above wherever headroom under it is less than 2.0 m, from the layout's footprint.

### 3A.7 Hands-on construction

Not connected yet. A stair is still one piece that is not made of members (`src/build.js` near 9201): it appears with the shell stage, and nobody cuts stringers. This plan gives the piece the numbers a later construction step needs (stringer length, tread and riser counts, baluster count) and adds them to the Materials list as lines if `FR.materialsList` takes extra lines without change; cutting and setting a stair by hand is a follow-up, not in this plan.

### 3A.8 Follow-up: deck stairs and the stair solver (after merging main's decks)

Main's decks (`src/sim/content/deck.js`, `planStair`) carry their own stair: from an open edge down to a precast pad at grade, risers at most 7-3/4 in and treads 10 in (IRC R311.7.5), solved against the terrain at the foot (the drop depends on the run, so it iterates), and emitted as framing members (2 x 12 stringers cut to the rise and run, treads, pads, handrails) that construction builds. The stair tool's solver (`src/sim/content/stairs.js`, type `deck`) lays out the same kind of stair as geometry only, with its own riser rule (190 mm max, aim 178 mm) and no members. They are left separate for now: unifying them means one rule set (the deck's IRC figures or `RULES.riser`), a ground-following foot in `solve` (`run` from the terrain), and deck members built from a `solve` layout. Then `planStair` becomes `solve({ type: 'deck', rise: drop, width: w, ... })` plus the pads, and the drawn deck steps and the stair tool's Deck steps agree. Until then a change to riser or tread rules goes in both files.

## 3B. What plan mode shows

### 3B.1 Today

- **With sandbox off (the real game) a drawn plan is a blueprint, not a house.** Unbuilt pieces are drawn by `drawMembers` as one blue shell (`shellMat`, the same geometry `buildGeo` makes for a finished building) plus a ghost box for every framing member of every later stage. The finished look only shows in sandbox, or once the building has been raised.
- Roofs are hidden for every tool except Roof, Remove, Equip on a roof and Select with "Show roofs" (`roofsShown`): `S.roofOp` fades `S.roofMat` and switches the roof member meshes.
- Storeys above the one being worked on are hidden whole (`S.group.visible = S.level <= B.level` in the update loop). Walls stand full height in plan mode.
- In play, third person, a building opens while you stand in it: walls are cut at 1.15 m by four clipping planes per building (`S.clip` horizontal, `S.near`, `S.sideA`, `S.sideB`, with `clipIntersection`), only between the camera and the player; first person keeps rooms whole. `renderer.localClippingEnabled` is already on and every wall, glass and member material is already compiled with those four planes.
- Nothing tells the player why a roof or a storey is missing, and there is no way to ask for a cut.

### 3B.2 The rule

Plan mode shows the house as it will look finished: walls in their material and paint, trim, windows and doors with glass, the roof on. Planned and built parts look the same here; what is still to build is the Materials panel's business (it gets a "Show what is left to build" switch that brings today's blueprint back). The view opens up only as far as the task in hand needs, says so in one chip, and closes again when the task ends. Play mode is not touched by this plan: no new cuts there.

### 3B.3 Automatic views

A view is four settings: which storeys are drawn, roof on or off, a cut height (or none), and the layer (finished, or structure below the floor).

| Task | Storeys | Roof | Cut | Chip |
|---|---|---|---|---|
| Select with nothing selected; Roof; Path; Measure; pointer outside every building | all | on | none | none |
| Door, Window | current and below | on if working on the top storey | none | "Storeys above hidden" when any are |
| Room, Wall | current and below | off | none | "Roof lifted" |
| Floor, Stairs, Pillar, Furnish, Equip indoors; a selected inside wall, floor, stair or furnishing | current and below | off | walls at 1.2 m above the current floor (dollhouse) | "Cut at 1.2 m" |
| A selected roof, or Equip on a roof | all | on | none | none |
| Stands on (foundation), or the floor frame, being changed: the control has focus or was changed in the last few seconds | ground only | off | just under the finish floor, structure layer: foundation and floor frame drawn solid, the rest hidden | "Showing the foundation" |
| Insulation or Inside (lining) being changed | current | off | 1.2 m, with the near wall's layers visible in the cut | "Showing inside the walls" |

The chip sits beside the view control and has a close button: closing it pins Finished until the tool changes. Changes fade over about 0.2 s (the existing `roofOp` and `cutH` easing); nothing animates when nothing changes.

### 3B.4 The view control

`#bview`, in the bar's right cluster next to the storey chips (it replaces the Roofs toggle of 2.6):

- A `.ui-seg` of four: **Auto** (default), **Finished**, **Cutaway** (roof off, storeys above hidden, walls whole), **Section**.
- Section shows a vertical height slider on the right edge of the view, drawn as an instrument (`--cad`): from the bottom of the foundation to the ridge, 0.1 m steps, with ticks at each floor and at 1.2 m above each floor; the value shows as a chip ("1.20 m above Ground"). Dragging it moves the cut live.
- The storey chips say which storey is being worked on; in Finished they change only where new pieces go, not what is drawn.
- Phone: the control is in the `...` sheet; the Section slider is 44 px wide on the right edge.
- The choice is kept for the session (`B.vmode`), not saved with the world.

### 3B.5 How it is drawn, cheaply

- **Finished look for planned pieces:** in plan mode `drawMembers` gives the shell geometry the building's own wall, roof and glass materials in place of `shellMat` (split back into the three meshes `buildGeo` already returns) and skips the ghost members. With "Show what is left to build" on, or outside plan mode, it draws as today. One implementer check: wall paint and trim reach the picture through member sets today; where a planned building's paint or trim does not show from `buildGeo` alone, draw those member sets solid for planned pieces too.
- **Cuts use the planes that are already there.** A horizontal section sets `S.clip.constant` to the cut height and sets the other three planes to always clip, so the intersection is the horizontal plane alone. No new material, no new shader program, no extra pass; the four plane tests per fragment are already being paid in every frame of the game today. three.js clipping planes are therefore cheap enough here, and per-group hiding (storeys, roof meshes, the structure layer's member meshes) covers the rest.
- **Cut faces:** walls are drawn double-sided, so a cut shows the wall's inside faces; member materials already cap (`capped`). No stencil caps are added. If the open wall tops read badly in playtest, the follow-up is a dark top strip added to the wall geometry at 1.2 m, not a pass.
- **Cost:** the planes, `group.visible` and `roofOp` are written only when the view's version changes (tool, selection kind, storey, mode, slider) or while a fade runs; the plan-mode branch of the update loop does nothing else.
- Shadows follow the cut (`clipShadows` is already set), so a lifted roof lets the sun into the rooms.

## 4. What stays and what changes underneath

Stays: every plan and save field, piece ids, `__build.pieces()`, `serialize`/`restore`, the schedule, `placePlan`, construction mode, snapping, undo, all letter keys, `#buildbar #bpieces #bopts #bdecor #bsnap #bsched #bschedp #bundo #bredo #bdone #bdesign #bover`, `.bchip .btile .bsw[title] .bdim .bhandle .bmeas .bport`, `data-piece`, `B.frameHook`.

Changes:

- **`view()` contract** (additive): each tool gets `cat` (`select|shell|door|window|more|inside|remove`); each group may carry `tier: 1` (tray) and otherwise goes to the inspector with its `sec`; new fields `inspector: { open, title, sub, icon, mode: 'next'|'sel' }`, `levels: [{ l, name, has, cur }]`, `coach: [{ id, text, done, tool }] | null`, `total` (plan cost or null), `fit: { ok, text, fixes: [{ id, label }] } | null`. `designTitle` and `row: 'd'` keep working until P7 lands.
- **New `choose` ids**: `insp` (toggle), `level:set` (a storey number), `o:anchor` (`sill|head|centre`), `o:y` (the anchored height), `o:pos` (distance from the run's left end), `o:align` (`centre|between|equal`), `o:hand` (`{ flip, out }`), `o:fix` (index into `fit.fixes`), `o:recent` (index).
- **One new saved field**: a free opening may carry `out: true` (opens outward). Absent means inward, so old saves are unchanged. `freeToFraming` ignores it.
- **`src/sim/content/openings.js`**: `family` on every type; `opts` on every door type (which designer groups apply: `face glass bars side transom hw metal finish leaves`); the new types of 3.2; pure helpers `anchorY(spec, anchor)`, `fromAnchor(type, h, anchor, y)`, and `fitReport({ type, w, h, sill, at, L, wallH, others })` returning `{ ok, issues: [{ code, by }], fixes: [{ code, patch }] }` with codes `tall wide end overlap range`.
- **View** (section 3B): `view().viewc = { mode: 'auto'|'finished'|'cutaway'|'section', chip: text or '', cut: metres or null, range: [lo, hi], ticks: [{ y, name }], left: boolean }`; `choose` ids `view:mode`, `view:cut` (metres), `view:unpin` (the chip's close), `view:left` (show what is left to build). No saved field.
- **Stairs** (section 3A): new `src/sim/content/stairs.js` (types, rules, the solver `solve({ rise, run, side, clear, width, type })` returning `{ type, n, riser, tread, flights, landing, footprint, headroom, ok, issues, fixes }`, and `heightAt(layout, x, z)`; pure), new `src/stairs-geo.js` and `src/stairs-spiral.js` (`window.__stairsGeo.build(layout, look)` returns the box lists; `draw(layout, size)` returns the side-view and thumb SVG), the optional stair fields of 3A.6, and `choose` ids `st:type st:width st:n st:turn st:at st:rail st:railStyle st:open st:nosing st:boxed st:mat st:fix`.
- **New `src/opening-preview.js`** (`window.__openingPreview`): string-building only, no DOM, no three.js, so it also runs under node. `draw(spec, { wall: { L, H, others }, at, size: 'stage'|'thumb', handles, hand })` returns SVG; `plan(spec, hand)` returns the door plan view. Stage handles are `<rect data-h="l|r|t|b|move">`. The window drawing moves here from `buildui.js` `winPreview`; its literal colours become `var(--cad)` and `currentColor`.

Test edits (all in `test/build.smoke.mjs`, made by the step that breaks them):
- line 40: "nine slots, each with a letter; every tool reachable by its letter" (`#bpieces button` count 9; loop the 14 letters and check `view().top`).
- line 56: unchanged (Room's tray still has 19 swatches and a pressed tile).
- lines 163, 176: unchanged (a selected wall keeps Material and Length in the tray).
- line 238: unchanged (`#bdecor .bchip`).
- lines 284-294 (phone): for `decor`, tap `#bpieces [data-group="inside"]` twice then `#bfly [data-piece="decor"]`; the bar-height bound becomes `< 200`.
- `test/plan-unbuilt.smoke.mjs`, `test/shed.e2e.mjs`, `test/shed.clumsy.mjs`, `test/construction-tools.smoke.mjs` drive `__build` and keys only; they must pass untouched.

## 5. Implementation steps

Shared rules: start from the newest `ui-redesign`; one commit per step saying what the player would notice; build with `flock /tmp/hs-build.lock sh build.sh`; run only the listed checks. `src/build.js` is 11,158 lines and three steps edit it: each owns the line ranges named (line numbers as of commit `5a5faec`; find the function by name if they have moved) and must not reformat or move code outside them. Steps in one wave touch disjoint files, except where marked.

### Wave 1 (parallel)

**P1 - View contract** (opus). Owns `src/build.js`: `TOOLS` (20-35), `HINTS` and `hint()` (6938-6984), `setTool` through `view()` (7337-7823), `choose()` (8368-8455) except its opening branches (`otype osize w: d: osill oflip odel`), `exit()`, and the Select click that lands on a free opening (input section 7150-7330).
- Add `cat` to `TOOLS`; tag groups `tier: 1` per the table in 2.2 and give every other group a `sec`; emit `inspector`, `levels`, `coach`, `total` as in section 4; add `insp`, `level:set`.
- Rewrite `HINTS` to the 70-character rule; stop the room-facts override; emit room facts as an info group for Roof and Select.
- Select on a free opening: `setTool(kind)`, set `B.fsel`, remember to return to Select on Esc.
- `exit()`: the toast of 2.7 through `window.__ui.toast` when it exists.
- Done: `node test/build.smoke.mjs`, `node test/plan-unbuilt.smoke.mjs` (the page still renders with the old `buildui.js`, which ignores the new fields).

**P2 - Catalogue data and fit rules** (sonnet). Owns `src/sim/content/openings.js`, `test/openings.test.mjs`.
- `family`, `opts`, the five data-only types and `door_cased` (data only here), `anchorY`, `fromAnchor`, `fitReport` as in section 4. `fitReport` uses the same constants as `snapFree` (`END_GAP`, `OPEN_GAP`, `ROUGH_GAP`, top plate 0.19 m below the wall height) and every fix's `patch` must itself pass `fitReport`.
- Tests: every type has a family; each code is produced by a case; a gothic window 2.4 m high on a 2.84 m wall yields fix "sill 0.24"; fixes pass.
- Done: `node --test test/openings.test.mjs`, `node --test test/framing.test.mjs` if present.

**P3 - The preview drawing** (opus). Owns new `src/opening-preview.js`, `build.sh` (add `opening-preview` after `build` in both module lists).
- Implement `draw` and `plan` as in section 4. Port the window drawing from `buildui.js` `winPreview` (do not edit `buildui.js`), then add doors: frame, leaves, each `DOOR_FACES` layout, each `DOOR_GLASS`, bars, sidelights, transom, handle on the latch side, and simple faces for slide, barn, pocket, fold and roll. Thumb size omits dimensions and handles.
- Write `/tmp/FAB/preview-all.html` from node with every type at stage and thumb size in both skins' token values, and look at it in Playwright.
- Done: that sheet shows every type recognisably; `node test/page.smoke.mjs`.

### Wave 2 (parallel)

**P4 - Bar, tray and inspector shell** (opus). Owns `src/buildui.js` (all but `winPreview` and the `winprev` branch of `groupHtml`), `template/ui/50-build.css`, `test/build.smoke.mjs` (the edits in section 4).
- Bar and `#bfly` flyouts (2.1), tray with `#bmore`, Paint and Pick (2.2), inspector drawer with a kit head and close, coach chips and hint row (2.4), storey chips and `#broofs` (2.6), Materials label, total and footer (2.7). Remove `#bfree` and `#bfold`. `B.barH` is computed from the fixed bar and tray height.
- Both skins; no literal colours; check Cozy and Minimal at 1440x900 and 1280x720 with the screenshot script.
- Done: `node test/build.smoke.mjs`, `node test/plan-unbuilt.smoke.mjs`, `node test/ui.smoke.mjs`.

**P5 - Opening rules** (opus). Owns `src/build.js`: free-opening placement (4594-4680), the opening block from `gapsBeside` through `doorChoose` (7826-8250), and the opening branches of `choose()`.
- `openingView`: tray groups are Recent and one tiles group per family (from `family`), each item with `name` and `thumb: typeId`; inspector groups in the sections and order of 3.1, driven by `opts` for doors; a `stage` group (replaces `winprev`, for doors too) carrying the spec, the wall run (`L`, `H`, `others`), position and hand; `view().fit` from `OP.fitReport`.
- Implement `o:anchor`, `o:y`, `o:pos`, `o:align`, `o:hand`, `o:fix`, `o:recent`; the apply-as-far-as-possible rule of 3.3 in `designSet`, `doorFits` and new placement; save `out`; recents written on placement.
- `selDims`: gaps and sill only while `B.ores` or a grab is active (2.5).
- Done: `node test/build.smoke.mjs`; in the page, `__build.choose('otype','gothic'); __build.choose('w:h', 2.4)` on a placed window leaves it placed with a lowered sill and a `fit` text.

**S1 - Stair rules and solver** (opus). Owns new `src/sim/content/stairs.js`, new `test/stairs.test.mjs`, `src/openings-global.js` (one line: also set `window.__stairs`).
- The types and rules of 3A.2, `solve` and `heightAt` as in section 4, Auto's choice as in 3A.3. Every fix returned must itself solve `ok`.
- Tests: 2.84 m rise with 4.5 m of run gives a straight stair of 16 risers near 178 mm; 0.45 m rise gives Steps with 3 risers; 3.0 m of run gives "too steep" with an L fix; a 1.6 m square gives a spiral with at least 2.0 m headroom; `heightAt` rises monotonically along each type and is flat on landings; an old `{ i, j, dir }` record converts.
- Done: `node --test test/stairs.test.mjs`.

### Wave 3 (parallel)

**P6 - Door meshes** (opus). Owns `src/build.js` lines 2560-3130 (the opening meshes).
- Honour `f.out` (the `side` of the swing mover). Draw patio, barn, pocket and bifold leaves through `leafFace` so `face`, `glass`, `bars` and `finish` apply; garage door takes `finish` and panel rows. `door_cased`: frame and casing, no leaf. A faint swing arc on the floor for the ghost and the selected door (one line mesh, reused).
- Done: `node test/build.smoke.mjs`, `node test/shed.e2e.mjs`; screenshot each door type placed on a wall.

**P7 - The designer panel** (opus). Owns `src/buildui.js` (the inspector's render and events, removing `winPreview`), a marked "designer" block at the end of `template/ui/50-build.css`, new `test/designer.smoke.mjs`.
- Render 3.1: head, sticky stage from `__openingPreview.draw`, door plan view, fit line with fix buttons, tabs, foot. Tray cards with thumbs and family tabs (3.2); thumbs are built once and cached.
- Stage dragging: pointer events on `[data-h]`, one `choose` per animation frame while a drag is live, none otherwise.
- `test/designer.smoke.mjs` (loader from `build.smoke.mjs`): place a window, open it from Select, resize from the stage, type a width, change anchor to Head and grow the height (sill moves), force a misfit and press the fix, hang a door and set it to open out, place a patio door and change its colour; panel content height fits the drawer without scrolling on Size & place at 1440x900; no page errors; save `dist/designer-<skin>.png`.
- Done: `node test/designer.smoke.mjs`, `node test/build.smoke.mjs`.

**S2 - Stair carpentry** (opus). Owns new `src/stairs-geo.js`, a stub `src/stairs-spiral.js`, `build.sh` (add `stairs-geo` and `stairs-spiral` after `opening-preview` in both lists).
- `build(layout, look)` for Steps, Straight, L, U, Winder, Ship's ladder and Deck steps as in 3A.5, every railing style and tread option; `draw(layout, size)` for the side view and the tray thumbs. Spiral is dispatched to `__stairsGeo.kinds.spiral`, which the stub leaves empty.
- Check by eye: a node script writes the box lists to a small three.js page under `/tmp/FAB/` and screenshots each type from two angles.
- Done: those screenshots read as carpentry (stringers, nosings, newels, balusters); `node test/page.smoke.mjs`.

### Wave 4 (parallel)

**P8 - Phone** (opus). Owns `src/touch.js`, `template/ui/60-touch.css`, the phone part of `test/build.smoke.mjs` (lines 280-298), and in `src/buildui.js` only the `B.barH` lines of `frame()`.
- 2.8: scrolling bar with pinned Undo and Done, the `...` sheet, bottom-sheet inspector with peek and full, sheet below the top HUD, 44 px handles, both orientations.
- Done: `node test/build.smoke.mjs`, `node test/ui.smoke.mjs`, `node test/designer.smoke.mjs`; screenshots at 390x844 and 844x390.

**S3 - Spiral stair** (opus). Owns `src/stairs-spiral.js`.
- `kinds.spiral(layout, look)`: centre post, tapered treads, balusters, helical handrail in straight pieces, a landing board at the top that meets the floor's edge; clockwise or anticlockwise; its `draw` thumb and plan view. Headroom and diameter come from the solver.
- Done: screenshots as in S2 from above and from the side; walking it in the page after S4 lands.

**S4 - Stairs in build mode** (opus). Owns `src/build.js`: `stairLen` through `stairPieces` (2179-2231), the stairs branch of placement (4422-4436), the stairs lines of bounds (3867), picking (5678-5685), save and load (4827, 4851), moving (6325), the pieces list (10599-10605), walking (10904), and the `stairs` branches of `HINTS`, `cycleStyle`, `selGroups`, `view()` and `choose()`. It is the only step editing `src/build.js` in this wave.
- Replace the fixed stair with solver layouts and `__stairsGeo.build`; the drag of 3A.3 including a foot on the ground and a head on a raised or split-level floor; Auto and the type override; `view().fit` with `st:fix`; tray and inspector groups of 3A.4 (a `stage` group with the side view); foot, head and landing handles; `wellOver` from headroom; old records converted on load.
- Extend `test/build.smoke.mjs` after the roof part: drag a stair in the house and check its piece (`type`, `steps`, riser between 150 and 190 mm), that the floor above is opened, and that the walking height (the hook near line 10904) climbs along it; place Steps between a floor and one raised 0.5 m.
- Done: `node test/build.smoke.mjs`, `node test/plan-unbuilt.smoke.mjs`, `node test/shed.e2e.mjs`.

### Wave 5 (parallel)

**V1 - Finished look and task views** (opus). Owns `src/build.js`: `roofsShown` (near 5597), the shell part of `drawMembers` (near 9436-9616), the plan-mode lines of the update loop (near 10976-11030: `S.group.visible`, `S.cutH` and the four planes, the roof target), and new `view:` branches in `view()` and `choose()` (added as their own lines; nothing else in those functions is touched). Line numbers are as of commit `7120c19`; find by name. It is the only step editing `src/build.js` in this wave.
- 3B.2 (finished look for planned pieces, the "left to build" switch), 3B.3 (one function `planView()` that turns tool, selection, focus and `B.vmode` into storeys, roof, cut and layer, with a version counter), 3B.5 (planes and visibility written on change only). Play mode's branch stays byte for byte.
- `__build.planViewState()` returns the current settings for tests.
- Done: `node test/build.smoke.mjs`, `node test/plan-unbuilt.smoke.mjs`, `node test/shed.e2e.mjs`, `node test/page.smoke.mjs`; screenshots with sandbox off of a planned house in Auto with Select, Furnish, and the foundation being changed.

**V2 - The view control** (opus). Owns `src/buildui.js` (the right cluster and a new overlay element), `template/ui/50-build.css` and `template/ui/60-touch.css` (a marked "view" block at the end of each), new `test/planview.smoke.mjs`.
- 3B.4 from `view().viewc`: the four-way control replacing `#broofs`, the chip with its close button, the Section slider (pointer events, one `choose('view:cut')` per animation frame while dragging), the Materials panel's "Show what is left to build" switch.
- `test/planview.smoke.mjs` (loader from `build.smoke.mjs`, sandbox off, `__build.placePlan('shed', ...)`): the planned shed is drawn with the wall material, not `shellMat`; Furnish gives a 1.2 m cut and no roof; changing "Stands on" gives the foundation view and the chip; Finished pins the whole house; Section at 2.0 m sets the plane; leaving plan mode restores play's values; no page errors; saves `dist/planview-<name>.png`.
- Done after V1 is merged: `node test/planview.smoke.mjs`, `node test/build.smoke.mjs`, `node test/ui.smoke.mjs`.

### Wave 6

**P9 - Sweep and docs** (sonnet). Owns `CLAUDE.md`, `ARCHITECTURE.md`, `docs/PLAYTEST.md`.
- `CLAUDE.md`: add `test/designer.smoke.mjs` and `test/planview.smoke.mjs` to the smoke list and `src/opening-preview.js`, `src/sim/content/stairs.js`, `src/stairs-geo.js`, `src/stairs-spiral.js` to the code map. `ARCHITECTURE.md`: the view contract additions and the `out` field. `docs/PLAYTEST.md`: what to try (plan a two-room house with a great hall, an arched window, a French door opening out, three steps down into a sunken room, an L stair to a loft, a spiral, porch steps from the ground, on desktop and phone, in both skins).
- Run the gates: `node test/page.smoke.mjs`, `build.smoke`, `plan-unbuilt.smoke`, `construction-tools.smoke`, `designer.smoke`, `planview.smoke`, `ui.smoke`, `shed.e2e`, and `node --test test/stairs.test.mjs test/openings.test.mjs`. Report failures to the owning step; fix nothing in `src/`.
- Then the owner playtests.

| Step | Model | Wave | Title | Files |
|---|---|---|---|---|
| P1 | opus | 1 | View contract | `src/build.js` (tools, hints, view, choose, exit) |
| P2 | sonnet | 1 | Catalogue data and fit rules | `src/sim/content/openings.js`, `test/openings.test.mjs` |
| P3 | opus | 1 | The preview drawing | new `src/opening-preview.js`, `build.sh` |
| P4 | opus | 2 | Bar, tray and inspector shell | `src/buildui.js`, `template/ui/50-build.css`, `test/build.smoke.mjs` |
| P5 | opus | 2 | Opening rules | `src/build.js` (placement 4594-4680, openings 7826-8250) |
| S1 | opus | 2 | Stair rules and solver | new `src/sim/content/stairs.js`, new `test/stairs.test.mjs`, `src/openings-global.js` |
| P6 | opus | 3 | Door meshes | `src/build.js` (2560-3130) |
| P7 | opus | 3 | The designer panel | `src/buildui.js` (inspector), `50-build.css` (designer block), new `test/designer.smoke.mjs` |
| S2 | opus | 3 | Stair carpentry | new `src/stairs-geo.js`, stub `src/stairs-spiral.js`, `build.sh` |
| P8 | opus | 4 | Phone | `src/touch.js`, `template/ui/60-touch.css`, `test/build.smoke.mjs` (phone part) |
| S3 | opus | 4 | Spiral stair | `src/stairs-spiral.js` |
| S4 | opus | 4 | Stairs in build mode | `src/build.js` (stairs: 2179-2231, 4422-4436, 10599-10605, 10904 and the stairs branches), `test/build.smoke.mjs` (stairs part) |
| V1 | opus | 5 | Finished look and task views | `src/build.js` (`roofsShown`, shell part of `drawMembers`, plan-mode lines of the update loop, `view:` branches) |
| V2 | opus | 5 | The view control | `src/buildui.js` (right cluster, slider), `50-build.css` and `60-touch.css` (view blocks), new `test/planview.smoke.mjs` |
| P9 | sonnet | 6 | Sweep and docs | `CLAUDE.md`, `ARCHITECTURE.md`, `docs/PLAYTEST.md` |

Merge risk: P1 (wave 1), P5 (wave 2), P6 (wave 3), S4 (wave 4) and V1 (wave 5) all edit `src/build.js`, one per wave, in different ranges; V1 adds `view:` lines to `view()` and `choose()`, which P1, P5 and S4 have edited before it, so it starts from the merged wave 4 and V2 codes against the contract in section 4 until V1 lands; S4 edits the `stairs` branches inside functions P1 reshaped, so it starts from the merged wave 3. In wave 4, P8 and S4 both edit `test/build.smoke.mjs` (P8 lines 280-298, S4 inserts after the roof part near line 92): merge S4 first. `choose()` is shared by P1 (wave 1) and P5 (wave 2), so P5 must start from P1's commit. P4 and P7 both edit `src/buildui.js` and `50-build.css` in consecutive waves, never the same one.

Not in this plan: building a stair by hand (3A.7), balconies, curved walls, free openings in angled or round walls (rustic pieces remain the answer there), new roof shapes, any change to construction or the plan book.
