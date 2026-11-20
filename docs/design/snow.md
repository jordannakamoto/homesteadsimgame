# Snow: simulation and rendering

Goal: snow that reads as well as Ghost of Yōtei's (deep, deformable, sparkling, on everything) on top of a snowpack
that is actually simulated, inside the 144 fps budget (no new full-screen pass, about 0.15 ms of sim per step).

What the references do, and what we take:

- **Ghost of Yōtei** (Sucker Punch tech deep dive): terrain tessellation + a displacement buffer deformed at run time;
  the same buffer lets characters knock snow off trees and bushes, spawning particles; a sparkle made from stable
  noise. We take all three ideas. We have no hardware tessellation in WebGL2, so the tessellation is a nested-ring
  grid that follows the player.
- **God of War Ragnarök** (Surricchio, GDC 2023): a persistent top-down target that scrolls with the camera, shapes
  rasterised into it, a composite pass that smooths and derives detail, real displaced geometry instead of the 2018
  screen-space parallax (which could not go deep or cast correct silhouettes). We keep the persistent top-down target
  and real geometry; we skip the composite pass by stamping analytic, already-smooth profiles.
- **Horizon: Frozen Wilds / RDR2**: sliding window, deformation refilled by new snowfall, trail map seeded from
  coarser persistent data. We do both.
- **Glints**: Bowles and Wang 2015 (anti-aliased procedural sparkle, as shipped) rather than Deliot and Belcour 2023
  (correct counting, but costly): a jittered world-anchored grid of facets, level chosen from the pixel footprint.
- **Snow science**: degree-day melt and bulk density already in `weather.js`; Winstral's upwind shelter index Sx for
  drifts; Li and Pomeroy's temperature-dependent transport threshold; Hedstrom and Pomeroy for canopy interception.

## 1. Two scales, one truth

| Scale | Where | Cell | Holds | Saved |
|---|---|---|---|---|
| Reference pack | `sys.weather` (unchanged contract) | the site | open-field SWE, bulk density, totals | yes |
| Snowpack | `sys.snow.grid` (new) | 0.5 m, 16 m tiles | SWE and packed SWE per cell | yes (earthwork codec) |
| Live deformation | GPU texture (new) | 5 cm, 51 m window | press, rim, rough, cleared | no: re-seeded from the snowpack |

The weather keeps the **open-field reference pack**: every other system keeps reading `weather.snowDepthM` exactly as
now. The snowpack distributes it in space: a level, open, untouched cell tracks the reference exactly. The GPU layer is
cosmetic detail on top (delete it and the sim gives the same world): footprints are lost when you leave, the packed
path they made is not.

## 2. Simulation

Files: `src/sim/core/snowfield.js` (generic: a granular deposit on a tiled grid; no homestead words),
`src/sim/content/snow.js` (constants), `src/sim/snow.js` (system `snow`, after `landscape` in `GAME_SYSTEMS`, `every: 10`),
`test/snow.test.mjs`.

### State

```
sys.snow = { v: 1,
  grid: { step: 0.5, T: 32, codes: [''], tiles: { 'tx,tz': { h, s, l, f, t } }, rev },   // earthwork format, so saves pack it
  meta: { 'tx,tz': { fall, melt, unload, worked } },     // the weather totals this tile has applied; worked: touched by hand or wheel
  focus: { x, z }, seen: { fall, melt },
  canopyMm, freshMm, obstacles: { v, trees: [[x, z, crownR, height, evergreen 0|1]] },
  totals: { fall, melt, unload, sublim, blown }, rev }    // totals in mm x cells, for the conservation test
```

Per cell (integers, so the codec packs them): `h` = SWE in micrometres of water (0.001 mm); `l` = the part of `h` that is
packed (trodden, driven on, thrown, wind slab), same unit, `l <= h`; `s`, `f`, `t` zero. Packed fraction `p = l / h`.
New snow adds to `h` only, so a path under fresh snow dilutes by itself; melt takes loose snow first (`l = min(l, h)`).

Density and depth are derived, never stored: `rho = rhoRef + (RHO_PACKED - rhoRef) * p` with `rhoRef =
weather.snowDensityKgM3` and `RHO_PACKED = 450`; `depth = SWE / rho`. `depth0 = SWE / rhoRef` is the depth before packing.

### Tiles

Tiles within 40 m of `focus` are active and are created on demand as `h = refSWE * catch(cell)` (no history: good enough
for ground nobody has seen). Tiles beyond 72 m are dropped unless `worked`; a worked tile sleeps with its `meta` totals and
catches up when next active by the same formula as a live step (fall and melt are both linear in the totals). `focus`
enters by command (`snow.focus`), sent by the page when the player has moved 8 m. Everything is deterministic.

### Each step, each active tile, each cell

```
dFall = W.totals.snowfallMm - meta.fall;  dMelt = W.totals.meltMm - meta.melt;  dUnload = unloadTotal - meta.unload
h += dFall * through(cell) + dUnload * canopy(cell)
h -= min(h, dMelt * meltFactor(cell));   l = min(l, h)
```

Static factors per tile (pure of site, obstacles and ground; cached outside state, rebuilt when `site.version`,
`obstacles.v` or the ground rev changes):

- `through` = 1 in the open; under a roof 0 (rasterise roof plane footprints and floors above ground from
  `site.pieces`); under an evergreen crown `1 - 0.45 * w` falling to `1 - 0.8` in the tree well (within 0.3 crown
  radius), `w` the crown's coverage at that cell; bare deciduous `1 - 0.08 * w`.
- `canopy` = where unloaded snow lands: a ring weighted to the crown's drip line (0.6 to 1.0 crown radius), normalised
  so the mean over covered cells is 1.
- `meltFactor` = `0.6 + 0.4 * sun` in the open where `sun` is the slope's clear-sky noon beam relative to level ground
  (south slopes go first), times 0.7 under evergreen crowns, times 1.25 within 1.5 m south of a wall, times 0.75 within
  3 m north of one. Normalised so level open ground is exactly 1.

Canopy store (one number for the site, per unit of crown area): gains `dFall * 0.45 * (1 - canopyMm / 6)`; unloads with
time constant 2 days when cold and calm, 6 h above 6 m/s, 3 h above 0 C; 25 % of what unloads has sublimated
(`totals.sublim`), the rest increments `unloadTotal`. Event `snow.unload { mm }` when a step sheds more than 0.3 mm.

`freshMm` (erodible layer of the reference): `+= dFall`, decays with a 1.5 day time constant, set to 0 above 0 C.

### Wind transport (every third step, on a 1 m grid over the active square)

Only when `windMs > Ut` and `freshMm > 0.05`, with `Ut = 9.43 + 0.18 T + 0.0033 T^2` m/s (Li and Pomeroy 1997, T in C).

1. Shelter, per cell, for the wind's direction: `Sx = max over d in {1, 2, 3, 4, 6, 8, 12} m upwind of
   (top(x - d * wind) - surf(x)) / d`, where `surf` = ground + snow depth and `top` adds obstacle height (walls and
   roofs from pieces; evergreen crowns at half height, being porous). Exposure `e = clamp(1 - Sx / 0.25, 0, 1.5)`: fully
   sheltered at 14 degrees, scoured (above 1) where the cell stands proud.
2. Pick-up `E = 0.02 * (U - Ut) * U` mm/h `* e`, at most half the cell's erodible snow `min(h - l, freshMm * through)`.
3. Twelve hops downwind: each hop moves the airborne load one cell (split between the x and z neighbour by the wind's
   components); on arrival a share `clamp(0.08 + 0.9 * (1 - e), 0, 1)` settles. Load cannot enter a cell under a roof or
   a wall: it settles in front. What is still airborne after the last hop settles where it is, or leaves the square
   (`totals.blown`).
4. Apply to the 0.5 m cells: erosion scales the loose part of the four cells; deposition adds equally, 35 % of it as
   packed (wind slab).

Because `surf` includes the snow, a drift grows in a lee until its own slope stops sheltering it: fences, sheds and
piles grow real drifts, ridges are scoured.

### Commands (all return `{ ok, ... }`, change nothing on failure)

- `snow.focus { x, z }`
- `snow.tread { pts: [[x, z, r, k]] }`: `l = max(l, h * k * w)` over the round footprint (`w` the cosine falloff the
  earthwork footprint uses). `k` is the presser's bearing ratio (below).
- `snow.move { x, z, r, frac, tx, tz, tr }`: a shovelful: takes `frac` of the SWE in the footprint, lands it on the
  target footprint, half of it packed, then relaxes the pile to a 45 degree repose. Conserves SWE.
- `snow.push { x0, z0, x1, z1, w }`: a plough or pusher: sweeps the strip clear, leaving the snow as a windrow along
  the downstream end and the right-hand side, 60 % packed. Conserves SWE.
- `snow.setObstacles { trees }` (page bridge), `snow.debugFall { mm, tempC? }` (sandbox: adds to the reference pack and
  its totals so everything stays consistent).

### Reads (`snowRead`, exported from `src/sim/index.js`, on the page as `__game.snow`)

- `at(state, x, z)` -> `{ sweMm, depthM, depth0M, packed, rho, sinkM }`, bilinear; the reference where there is no tile.
- `window(state, cx, cz, n, out)`: fills a `Float32Array(n * n * 4)` of 0.5 m cells centred on `(cx, cz)` (snapped to
  cells) with `[depth0M, rho / 600, packed, 0]`, toroidally addressed (`index = mod(cellIndex, n)`), and returns the
  snapped origin. This is the field texture.
- `bearing(rho, rhoBear)` -> `k = clamp((1 - rho / rhoBear) / (1 - rho / RHO_PACKED), 0, 1)`: how far a presser packs
  the column. `RHO_BEAR`: boot 330, tyre 400, hoof or small animal 200, sled 250. Fresh powder (100): a boot goes 0.9 of
  the way; week-old snow (300): 0.27; old crust (380): it carries you.
- `sinkM = depth0 * (1 - rho / RHO_PACKED) * k_boot * (1 - packed)`: how deep a boot goes; the page slows walking by it.

### Tests (`test/snow.test.mjs`, registering only `weather`, `site`, `ground`, `landscape`, `snow`)

Conservation over a winter (sum of `h` = fall - melt + unload - blown within 0.5 %); an open level cell equals the
reference; a shed's lee holds more snow than its windward side after a windy storm; under a roof stays bare; a north
wall keeps snow longer than a south wall in the thaw; tread, move and push conserve SWE and a trodden cell is shallower;
a save round trip is exact and packed; a sleeping worked tile catches up to the same state as one that stayed active
(without wind); cost under 0.2 ms a step for the 5 x 5 active tiles (`BENCH=1`).

## 3. Rendering

Folder `src/snow/`, bundled as one add-on (`dist/snow.min.js`, after `weather-view` in `build.sh`); reaches the game
only through `window.__game`; exposes `window.__snow`. The ground whitening moves out of `weather-view.js` (which keeps
the falling flakes and the readout).

### Textures

| Texture | Size | Addressing | Channels |
|---|---|---|---|
| `uSnowField` | 192 x 192 RGBA16F, linear | toroidal (`uv = world / 96`), 0.5 m | depth0 m, rho / 600, packed, spare |
| `uSnowGround` | 128 x 128 R32F, nearest (manual bilinear in the vertex shader) | toroidal, 0.5 m | ground height m |
| `uSnowLive` | 1024 x 1024 RGBA16F, trilinear with mips (512 on Medium) | toroidal, 5 cm | press, rim, rough, cleared |

Toroidal addressing means nothing is ever copied when the windows move: only the strip that came into view is
rewritten (field and ground on the CPU; live on the GPU). The field is rebuilt from `snowRead.window` when `sys.snow.rev`
changes; the page zeroes texels under stream water and below the sea. Beyond the field window the shaders fall back to
the reference depth as a uniform, blended over 6 m.

### Live deformation (`src/snow/live.js`)

Every presser stamps a **capsule** from where it was to where it is (so ruts are continuous at any speed), as one
instanced quad drawn four times with wrap offsets, with `MAX` blending on all four channels: no ping-pong, no full pass.

```glsl
float d = sdSegment(vW, p0, p1) / r;                                   // 0 on the centre line, 1 at the presser's edge
float press = k * (1.0 - smoothstep(0.75, 1.0, d));                    // flat floor, steep wall
float rim   = k * smoothstep(0.85, 1.05, d) * (1.0 - smoothstep(1.15, 1.9, d));
float rough = q * (1.0 - smoothstep(1.0, 2.4, d)) * vnoise(vW * 23.0); // kicked clumps round it
gl_FragColor = vec4(press * tread(vW), rim, rough, cleared);           // tread: lug or sole pattern, 0.88..1
```

- `k` is the same bearing ratio sent to the sim in `snow.tread`, so the fine and coarse pictures agree.
- Rim volume: about a quarter of what a boot displaces goes sideways, the rest is compaction. With the ring's area about
  1.45 times the print's, rim height = `0.17 * S * rim`.
- **Refill and ageing**: while it snows, blows or thaws, every 0.25 s one quad multiplies the texture
  (`blend: dst * src`): press by `exp(-newDepth / 0.08)`, rim and rough also by wind and thaw. Tracks fill in; packed
  paths stay visible through `uSnowField.b`.
- **Seeding**: a strip that scrolls into the window is written as `press = packed` from the field texture (with noise
  breakup), not zero, so old paths are there when you come back.
- Mips are regenerated only on frames that stamped. Stamps are batched (64 an instance buffer).

Pressers (`src/snow/actors.js`): the player's feet (alternating, on the walk cycle; a body-wide trench when the sink is
over 0.25 m; roll and landing as wide stamps), each vehicle wheel (from `__vehicles` contact points; rut depth from the
wheel load; spinning wheels dig and throw `rough` behind), trailer wheels, chickens and animals (tiny `k`), dropped logs
and felled trees (a long capsule), shovel and plough (the `cleared` channel). Treads are batched to the sim twice a second.

### Surface height (shared by vertex and fragment)

```glsl
float S   = D0 * clamp(1.0 - rho600 * (600.0 / 450.0), 0.0, 0.9);      // the most this column can be pressed down
float p   = live.r;                                                     // inside the live window (seeded from packed)
float H   = ground + 0.015 + (D0 * undulate(w) * (1.0 - live.a) - p * S
          + 0.17 * S * live.g * (1.0 - smoothstep(0.0, 0.25, p)) + 0.02 * live.b) * edgeFade;
```

`undulate` is two octaves of value noise (2.7 m and 0.9 m, +-10 % and +-4 %), stretched along the wind when the snow is
wind-packed, so open snow is never a flat plane. `edgeFade` takes the thickness to zero over the last 5 m of the
window, where the whitened terrain takes over.

### Geometry (`src/snow/surface.js`)

Three nested square rings centred on the player and snapped to 0.8 m, so every vertex always lands on its own world
lattice (nothing swims): 12.8 m at 10 cm, 25.6 m at 20 cm, 51.2 m at 40 cm; about 82 k triangles (Medium: two rings,
45 k). The outer row of each finer ring has its odd vertices collapsed onto the even ones, so rings meet without
cracks. Coarser rings read `uSnowLive` at mip 1 and 2. Fragments with less than 2 to 4 cm of snow (dithered by noise) are
discarded: there the whitened terrain shows, with grass tips through it. The mesh receives shadows and does not cast.

Field-scale slope is computed in the vertex shader (four taps of field + ground) and passed down; the fragment adds
the live texture's slope (four taps) and a micro normal:

```glsl
vec2 e = vec2(uLiveTexel, 0.0);
float hx = hLive(uv + e.xy) - hLive(uv - e.xy), hz = hLive(uv + e.yx) - hLive(uv - e.yx);   // hLive = -p*S + rim + rough terms
vec3 N = normalize(vec3(-(vSlope.x + hx / (2.0 * CELL)), 1.0, -(vSlope.y + hz / (2.0 * CELL))));
float cavity = clamp((textureLod(uSnowLive, uv, 0.0).r - textureLod(uSnowLive, uv, 3.5).r) * S * 6.0, 0.0, 0.6);  // sky hidden in a rut
```

### Material (`src/snow/shade.js`)

A `MeshLambertMaterial` with `onBeforeCompile` (shadows, fog, lights and tone mapping stay the engine's), with the direct
term replaced (`RE_Direct`):

```glsl
// light wraps past the terminator (multiple scattering) and comes back bluer where it travelled far
float ndl = dot(N, L), wrap = clamp((ndl + 0.35) / 1.35, 0.0, 1.0);
vec3 tint = mix(vec3(0.60, 0.80, 1.0), vec3(1.0), smoothstep(0.0, 0.5, ndl));
diffuse += lightColor * wrap * tint * albedo / PI;                       // lightColor already carries the shadow
// thin raised lips lit from behind glow
diffuse += lightColor * albedo * 0.35 * live.g * pow(clamp(dot(V, -L) * 0.5 + 0.5, 0.0, 1.0), 3.0);
// glints
diffuse += lightColor * snowGlints(w, Nsmooth, V, L, metresPerPixel) * GLINT * fresh * (1.0 - p);
// sky light hidden in ruts; indirectDiffuse *= 1.0 - cavity
```

Glints: world-anchored, never animated; they change only when the camera or sun moves.

```glsl
float glintLevel(vec2 w, float cell, vec3 N, vec3 Hh, float px) {
  vec2 g = w / cell, id = floor(g), f = fract(g);
  vec3 r = hash33(vec3(id, cell * 17.0));
  float a = 6.2832 * r.z, t = 0.6 * sqrt(hash13(vec3(id.yx, 7.0 + cell)));          // facet tilted up to ~30 deg
  vec3 T = normalize(cross(N, vec3(0.0, 0.0, 1.0))), B = cross(N, T);
  vec3 m = normalize(N + t * (cos(a) * T + sin(a) * B));
  float spec = smoothstep(0.985, 0.9985, dot(m, Hh));                                // a mirror facet: lit only at the half vector
  float dot_ = 1.0 - smoothstep(0.0, 1.0, length(f - (0.25 + 0.5 * r.xy)) * cell / max(px * 0.75, 0.004));
  return spec * dot_;
}
float snowGlints(vec2 w, vec3 N, vec3 V, vec3 L, float px) {       // px: metres a pixel covers here
  float lvl = max(0.0, log2(px * 3.0 / 0.008)), l0 = floor(lvl);    // the two grids bracketing ~3 px a cell
  float c0 = 0.008 * exp2(l0);
  vec3 Hh = normalize(L + V);
  return mix(glintLevel(w, c0, N, Hh, px), glintLevel(w, c0 * 2.0, N, Hh, px), lvl - l0);
}
```

Albedo (linear, before the engine's exposure): fresh `(0.86, 0.89, 0.93)`, a week old `(0.76, 0.78, 0.80)`, wet thaw
`* 0.9`; where a rut is pressed to within 3 cm of the ground the terrain's colour shows through (dirty tracks). Packed
snow is smoother (micro normal off) and a touch darker; wet or crusted snow gets a broad low sheen toward the sun.
`fresh` = `clamp(freshMm / 3, 0, 1)` when below 0 C.

### Ground, grass and everything else

- **Terrain** (`src/snow/ground.js`): the old whitening, driven per fragment by the field (one fetch), so a cleared path
  is brown and a drift is white at any distance; same albedo as the surface so the two meet invisibly.
- **Grass**: one field fetch per vertex at the tuft's root: a tuft shorter than the snow is collapsed (no fill cost); a
  taller one is bent and shortened by the depth and its tips whitened. Tufts through thin snow are the look of the
  first snowfall.
- **Objects** (`src/snow/objects.js`): `__snow.cover(material, { kind })` patches any material: snow on faces that look
  up (world space, so turned rocks and player-built pieces work), thicker on flats than on pitches, only where the
  fragment is not below a roof (`uSnowRoof`: a top-down height of roofs and upper floors, 0.5 m, rasterised from the
  pieces when the build version changes). Applied to build mode's materials, rocks, logs, tree crowns, the ATV and
  trailer. Amount from the reference depth; tree crowns from `canopyMm`.
  As built: the roof map is 192 x 192 RGBA32F on the field's grid (nearest): the roof plane's height at the cell
  centre, its x and z slope, and the cell's highest point (the plane is capped there, so a ridge cell does not bare a
  strip); snow needs `y >= roof - 0.35 m`. Buildings are found through `__build.groups()`, vehicles through
  `__vehicles.roots()`, trees and rocks through `__game.materials`, ground cover through `__nature.materials` (sunk
  into the snow by its depth). The page sends the trees round you (`snow.setObstacles`) every 16 m whenever it is below 3 C or snow lies, so the
  first fall is intercepted.
- **Knocking snow off** (the Yōtei trick): chopping or bumping a tree, or the wind's `snow.unload` event, clears that
  crown (up to 8 recent shake points in a uniform), drops a burst of clumps and powder, and stamps clump craters into
  the live texture under the drip line.
- **Kick-up**: powder puffs at feet and wheels in loose snow deeper than 5 cm, a rooster tail from spinning tyres.

### Quality and flags

Low: whitening only (field-driven). Medium: 512 live texture, two rings. High and Ultra: as above. Without
`EXT_color_buffer_half_float` / `float`, or on a software renderer: whitening only.

`__snow.set({ surface, glints, scatter, rims, bury, objects, undulate })` to compare looks (kept in `localStorage`),
`__snow.info()`, `__snow.debug.storm(cm)`, `.thaw()`, `.view('press' | 'depth' | 'packed' | 'normal' | null)`.

## 4. What it changes in play

- Walking speed drops with the boot's sink (to 55 % at 40 cm): you make paths because paths are faster, and they stay.
  As built: `player.groundPace` (the engine multiplies it into the walk), `1 - 0.55 * (1 - exp(-sink / 0.25))`, eased.
- Wheels read the local snow: `snow` (loose, drag grows with depth), `snow_packed` (slicker, no drag), bare where cleared.
- Shovelled and ploughed snow goes somewhere and stays there until it melts, last of all.

## 5. Overlap with the other physics, and refactors

Done here:

1. The ground whitening leaves `weather-view.js` for `src/snow/` (one owner for snow on screen).
2. `core/snowfield.js` stores its cells in the earthwork tile format, so `earthwork-codec.js` packs it with no change.
3. The wheel surface lookup (`game/vehicles-atv.js`) reads the snow where the wheel is, not the site's depth.
4. `src/snow/gpu.js`: the off-screen plumbing three GPU windows now need (target factory, render-to-target with state
   restore, software-renderer test, toroidal window maths).

Proposed, not done (other sessions are in these files):

5. Move `ripple-sim.js` and `rivers-live.js` onto `gpu.js`, and their copy-on-shift windows to toroidal addressing.
6. One presser list for the world: the wake simulation's `mover`/`drop` and the snow's stamps are the same event
   (something of this size pressed here with this speed). `__game.contacts` fed once by player, wheels and animals,
   read by water, snow, later mud and tall grass.
7. Snow as a material of the one ground: `snow.move` and `snow.push` mirror `ground.cut/fill/push`; the Yard shovel and
   a plough blade should call whichever layer is on top.
8. Consumers that should read the snowpack instead of the reference: `structure` (drift and unbalanced roof loads, which
   it lists as not modelled), `thermal` (snow on a roof insulates), `garden` (cover over a bed protects from frost),
   `streams` and `soilwater` (melt where it happens), `electrical` (panels shed snow by pitch).
9. The engine's sky-visibility map and the snow's roof map are the same question (what is overhead); merge them so
   roofs also darken the ground's sky light.

## 6. Order of work

1. Sim (`core/snowfield.js`, `snow.js`, tests) and, in parallel, the renderer core (`gpu`, field, ground texture, live,
   surface, shade, terrain and grass, player and wheel pressers, flags, `test/snow.smoke.mjs`).
2. Objects, knocking snow off, kick-up, walking speed, wheel surfaces.
3. Later: the snow shovel and a plough blade as tools, roof snow as its own store (sliding off metal roofs into piles
   under the eaves), refreeze and ice, the consumers in 5.8.

## 7. Revision after the first playtest: shape

The first build's tracks were clean capsules with a smooth ridge, a boot print was under three texels wide, sunlit
snow sat at the tone curve's top so relief vanished, and the deep snow ended in a visible disc from the high camera.

What snow does (Fearing 2000, Filhol and Sturm 2019, Schmidt and Gluns 1991, Schmidt and Pomeroy 1990):

- It lands on whatever faces the sky, then slumps to an angle of repose that rises with temperature (cohesion): about
  35 to 40 degrees cold and dry, near vertical and overhanging close to 0 C. So a cap is widest at its base and
  rounded; on a narrow support its height is limited by the support's half-width.
- On a bough it starts as a ridge on the top line, bridges between twigs by cohesion into one cushion along the
  bough, and saturates as the bough bends and sheds. Flat boughs carry most; bare limbs a thin line and fork wedges.
- Disturbed snow breaks into clumps: walls fall in, what is pushed out lies in lumps.
- It mounds where something is under it (it drapes: thin snow follows the shape, deep snow smooths it away), where
  the wind drops it (lees), and where it falls from above (drip lines, eaves); it hollows round trunks (tree wells).

Changes:

- Live texture 2.5 cm a texel (2048 on High, 1024 on Medium); a fourth, 5 cm ring under the player. The fragment
  reads the mip that matches the pixel, not the ring.
- Stamps: the edge is warped by world-anchored noise, the floor is lumpy, the rim is a jittered grid of domes
  (`clumps`), a few thrown further; `uneven` per presser (feet 0.75 to 1, tyres 0.3, blades low). Clump height
  `min(0.16, 0.5 S)`; clumps that fell back in keep a quarter of it.
- Feet: wider prints, toes out, jittered, a drag groove behind each from ankle depth; wading is a 60 cm rough trench
  with a leg hole to the bottom at each stride.
- The rut's own shadow: three taps of the live height toward the sun (the snow mesh casts none). Sky occlusion in a
  rut is now slight: cutting the blue sky light left the warm sun and turned rut floors tan.
- `drape.js`: rocks, stumps and logs as soft domes in a 20 cm texture; the surface banks up against the ones that
  stand clear and pillows over the ones it has covered, flattening with depth. `lumps.js`: low tussock hummocks and
  small fallen clumps, the clumps thick where a crown hides the sky.
- The surface's thickness fades on a circle, and grass stalks beyond it show only what would stand clear, so nothing
  marks where the deep snow ends.
- `clumps.js`: cushions along evergreen boughs and caps on rocks, stumps and logs, as instances; crown whitening
  is only a dusting. `uSnowStick` (cohesion from temperature) fattens or thins them.
- `__snow.tune({ albedo, wrap, cavity, shadow, lumps })` changes the look numbers live.

Still open: roofs carry a tint, not a slab with a rounded, overhanging eave; no scour moat round posts and trunks.
