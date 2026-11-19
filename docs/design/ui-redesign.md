# UI redesign: one game HUD, two skins

Plan for the `ui-redesign` branch. Implementers: read this, `CLAUDE.md` and the section of `ARCHITECTURE.md` on add-ons. Rules that bind every step: 144 fps (no per-frame JS in the UI, animate only `transform`/`opacity`, no new full-screen passes), add-ons reach the engine only through `window.__game` / `__build` / `__nature`, one page built by `build.sh`, combat stays dormant, no file moves or renames.

## 0. What is on screen today (1440x900 and 390x844 screenshots)

- Reads as a web app: nine text-only buttons in the tool bar, four separate one-button panels stacked down the left edge (Items/Supplier/Projects, Chickens, Home, Build), and a top-right bar that mixes the clock with FPS, seed and six settings buttons.
- Two hotbars show the same number keys at once (tool bar 1-7 and the garden bar 1-6), and a toast draws on top of the garden bar.
- Phone portrait is broken: the money readout sits under the Items bar, the settings column fills the right edge, the garden bar covers both sticks, and the combat buttons (Bow, Kick, Parry, Dash, Attack) show in the peaceful game.
- Supplier: 21 category chips, then rows with density, R-value and bending strength on every line.
- Colours are literals: about 250 hex values in the hotbar icons, and `rgba(226,182,90,..)`, `rgba(22,28,30,..)`, `#b8e08a` and friends through `template/head.html` and six injected `<style>` blocks.
- Already good, keep: `src/engine/hands.js` is one shared hotbar (`.hslot`) for Garden, Yard and Site; the build bar's structure; the `.panel` base class (the engine's HUD-blur switch targets it).

## 1. Design direction

1. **One hotbar at a time.** Bottom centre holds one row of chunky slots (icon, short label, keycap). In a sub-mode (Garden, Yard, Site, Hands) the mode bar collapses to a single mode chip at the left of that mode's slots; tapping the chip or Esc goes back. Build mode swaps the whole row for the build bar, as now. Number keys always mean the slots you can see.
2. **Icons first, words second.** Every HUD control has an icon; labels are one word. Numbers the player watches (money, time, meters) are large; everything else is behind a tap.
3. **A fixed frame with lanes.** Top-left: what you have. Top-right: time, weather, speed, gear. Left edge: the dock (launchers). Bottom centre: hotbar. Above the hotbar: one prompt. Top centre: toasts. Nothing else is pinned; elements in a lane stack and cannot overlap.
4. **One panel pattern.** Every system panel is a drawer with the same header (icon, title, optional money, close), opened from the dock, one open at a time, Esc closes. On a phone the same panels are bottom sheets.
5. **Press feel.** Every button sinks on press and the selected slot lifts with a marker. Counters pop when they change. No hover-only information, no dense forms: steppers and big tiles, detail behind an info toggle.
6. **No help panel.** `#help` stays hidden; teaching is the existing one-line prompt and the single quest card. Developer readouts (FPS, seed) and settings live in the gear drawer.
7. **Build tools stay precise.** Dimension chips, snap markers and handles keep their own instrument colour (`--cad`) in both skins.

## 2. Skin system

`<html data-skin="cozy|minimal">`. Default **cozy** (fits the genre and the "approachable" brief; minimal is one tap away). Saved in `localStorage['ui:skin']`. An inline script in `<head>` sets the attribute before first paint. `window.__ui.skin.set(name)` switches live and fires `window` event `ui:skin`. The gear drawer shows the two skins as two preview tiles.

All CSS lives in `template/ui/*.css`, inlined by `build.sh` in name order as a second `<style>` after the one in `head.html`. Tokens are defined on `:root[data-skin=...]`. The legacy variables are aliased so untouched rules follow the skin: `--panel: var(--surface-1); --panel-edge: var(--edge); --font-display; --font-body; --ink; --ink-dim; --accent; --danger`.

### Tokens

| Token | minimal | cozy |
|---|---|---|
| `color-scheme` | dark | light |
| `--font-body` | `"Inter","SF Pro Text","Segoe UI Variable Text","Segoe UI",Roboto,system-ui,sans-serif` | `"Nunito",ui-rounded,"SF Pro Rounded","Hiragino Maru Gothic ProN","Segoe UI",system-ui,sans-serif` |
| `--font-display` | same as body | `"Fredoka","Nunito",ui-rounded,"SF Pro Rounded",system-ui,sans-serif` |
| `--fw-body` / `--fw-strong` / `--fw-display` | 500 / 650 / 650 | 700 / 800 / 600 |
| `--label-transform` / `--label-track` | uppercase / .06em | none / 0 |
| `--r-sm` / `--r-md` / `--r-lg` / `--r-slot` | 6 / 10 / 14 / 12 px | 12 / 18 / 26 / 20 px |
| `--border-w` | 1px | 2px |
| `--surface-1` (HUD chips over the world) | `rgba(16,19,23,.62)` | `rgba(255,249,236,.95)` |
| `--surface-2` (panels) | `rgba(16,19,23,.90)` | `#fff9ec` |
| `--surface-3` (button face, rows, cards) | `rgba(255,255,255,.08)` | `#ffffff` |
| `--surface-hover` | `rgba(255,255,255,.14)` | `#fff3d6` |
| `--well` (inputs, meter tracks) | `rgba(0,0,0,.35)` | `#efe2c6` |
| `--edge` / `--edge-strong` | `rgba(255,255,255,.12)` / `rgba(255,255,255,.28)` | `#e6d6b2` / `#cdb78a` |
| `--ink` / `--ink-dim` / `--ink-inv` | `#f3f5f7` / `#a3acb5` / `#14181c` | `#4a3526` / `#8b7459` / `#fffaf0` |
| `--accent` / `--accent-ink` / `--accent-soft` / `--accent-edge` | `#ffd166` / `#1b1708` / `rgba(255,209,102,.18)` / `#ffd166` | `#35a865` / `#ffffff` / `#dff3e3` / `#2c8f55` |
| `--select-bg` / `--select-ink` / `--select-edge` | `#f3f5f7` / `#14181c` / `transparent` | `#ffffff` / `#256b43` / `#35a865` |
| `--good` / `--warn` / `--danger` / `--info` / `--money` | `#7ddc9a` / `#ffb84d` / `#ff7a66` / `#7cc7ff` / `#ffd166` | `#2f9e5b` / `#d98a12` / `#d9503b` / `#2e8fd6` / `#b97a10` |
| `--shadow-1` (chips, slots) | `0 1px 2px rgba(0,0,0,.35)` | `0 3px 0 rgba(122,92,48,.30), 0 6px 14px rgba(70,48,20,.18)` |
| `--shadow-2` (panels) | `0 12px 32px rgba(0,0,0,.45)` | `0 5px 0 rgba(122,92,48,.28), 0 16px 36px rgba(70,48,20,.24)` |
| `--lip` / `--lip-accent` (button bottom edge; collapses on press) | `none` / `none` | `0 3px 0 #d9c69c` / `0 3px 0 #267a49` |
| `--press-y` / `--press-scale` | 0 / .97 | 3px / .95 |
| `--blur` | `blur(10px) saturate(1.2)` | `none` |
| `--ease` / `--t-fast` / `--t` | `cubic-bezier(.2,.8,.2,1)` / 80ms / 140ms | `cubic-bezier(.34,1.56,.64,1)` / 110ms / 220ms |
| `--icon-stroke` / `--icon-fill` | 1.75 / `none` | 2.25 / `color-mix(in srgb, currentColor 18%, transparent)` |
| selected-slot marker | 16x3 px bar under the slot, `--select-bg` | 12 px diamond above the slot in `--accent`, bobbing 1.6 s (the plumbob touch) |
| `--ic-outline` | `#e9eef2` | `#5b4330` |
| `--ic-wood` / `--ic-steel` / `--ic-stone` | `#c9a36f` / `#b7c0c8` / `#9aa0a6` | `#c48a4a` / `#9aa7b2` / `#a9a294` |
| `--ic-leaf` / `--ic-water` / `--ic-soil` | `#8fd16a` / `#7cc7ff` / `#7a5a3c` | `#58b54a` / `#3f9fe0` / `#8a5d3a` |
| `--ic-skin` / `--ic-paper` / `--ic-warn` | `#e9b88f` / `#f2e8c8` / `#ffb84d` | `#f0bf96` / `#fff3cf` / `#e9a11f` |

Same in both skins: `--sp-1..5: 4 8 12 16 24px`; type scale `--fs-xs 11, --fs-sm 13, --fs-md 15, --fs-lg 18, --fs-xl 24px` (body 15px); `--r-pill: 999px`; `--slot: 64px` (56px under `body.touch`); `--hit: 44px` minimum touch target; `--float-ink: #fff7dc; --float-shadow: 0 1px 4px rgba(0,0,0,.85)` for text drawn straight on the world; `--cad: #9fe3ff; --cad-ink: #dff5ff; --cad-bg: rgba(16,24,30,.92)` for build-mode instruments; focus ring `2px solid var(--accent-edge)`, offset 2px.

Fonts: the Google Fonts link becomes `Nunito:wght@600;700;800` + `Fredoka:wght@500;600` with `display=swap`. Offline, cozy falls back to the system rounded face and minimal never needs the network.

Performance: cozy uses no `backdrop-filter`. Minimal blurs only `.panel` surfaces, so the existing Graphics switch (`hudBlur`) still turns it off; every blurred surface must carry class `panel`. Panels are opaque enough to read without blur.

### Components (`template/ui/10-kit.css`)

State comes from attributes only: `aria-pressed`, `aria-selected`, `disabled`, `.dim`, `[hidden]`. Tones are `.is-good`, `.is-warn`, `.is-bad`.

| Class | What it is |
|---|---|
| `.panel` | Base surface: `--surface-1`, `--border-w` edge, `--r-md`, `--shadow-1`, `--blur`. Kept as the base name. |
| `.ui-btn` (+ `--go`, `--ghost`, `--danger`, `--icon`) | Button: `--surface-3` face, `--lip`, sinks by `--press-y` and `--press-scale` on `:active`. `--go` is solid `--accent` with `--accent-ink`. Min height 36px, `--hit` under `body.touch`. Bare `button` gets the plain `.ui-btn` look so unconverted buttons match. |
| `.ui-slot` | Hotbar slot, `--slot` square: icon 32px, `.nm` label, `.ui-key` keycap top-left, `.bdg` count top-right, `.mtr > i` meter along the bottom. Pressed: `--select-bg`/`--select-ink`/`--select-edge`, lifts 6px, shows the marker. The same rules are bound by selector list to `.hslot`, `#tools button` and `#bpieces button`; those names stay. |
| `.ui-key` | Keycap. Hidden under `body.touch`. |
| `.ui-chip`, `.ui-tag`, `.ui-badge` | Pill readout (icon + value); small status label with tones; count bubble. |
| `.ui-seg`, `.ui-tabs` | Segmented control (`aria-pressed`) and tabs (`role=tab`, `aria-selected`): one well with a sliding selected face. |
| `.ui-card`, `.ui-row` | Card (`--surface-3`, `--r-md`, optional `.go` action) and list row. |
| `.ui-step` | Stepper: minus, number, plus, unit. Replaces free number inputs outside build mode. |
| `.ui-meter` | Track in `--well`, fill in a tone, optional leading icon. |
| `.ui-panel` | Drawer shell: `.ui-panel__head` (icon, `h2`, `.ui-panel__aside`, `.ui-close`), `.ui-panel__note` (one line, tones), `.ui-panel__body` (scrolls). Uses `--surface-2`, `--r-lg`, `--shadow-2`. Variants `--side` and `--modal`; both become bottom sheets on a phone. |
| `.ui-toast`, `.ui-prompt` | Toast (top lane, slides in, fades). Prompt (prompt lane): keycap, text, optional progress bar. |
| `.ui-fab` | Round touch action button, 72px. |
| `.ui-ic` | Icon: `fill: var(--icon-fill); stroke: currentColor; stroke-width: var(--icon-stroke)`, round caps and joins, 24px grid. |

### Icons

- **Interface icons** come from `__ui.icon(name)` (inline SVG string, class `ui-ic`, `currentColor`). Content adds its own with `__ui.icons.add({ name: innerSvg })`. First set: `coin wood stone bag shop list hen home hammer gear close back menu check plus minus info sun moon cloud rain snow pause play fast faster fastest bolt apple axe dig raise level sprout shrub stake hand blueprint`.
- **Item pictograms** (the `ICONS` maps in `garden-view.js`, `landscape-view.js`, `foundation-view.js`) stay multi-colour, but every literal hex becomes the nearest `--ic-*` token as a presentation attribute: `fill="var(--ic-wood)" stroke="var(--ic-outline)"`. Verified in Chromium: `var()` resolves in SVG `fill` and `stroke` attributes. Crop and material swatch colours that come from data (`hexOf(CROPS[c].col)`, service colours) stay as data.

## 3. Layout

### Desktop

```
+--------------------------------------------------------------------------+
| [coin $4,000][wood 12][stone 3]        toasts       [Day 1 08:10][5C sun]|
| [energy ====][hunger ===]                           [|| > >> >>> >>>>][*]|
| [Bag]                                                                    |
| [Shop]                                                   +-- drawer ----+|
| [Hens]                                                   | icon Title  x||
| [Home]                                                   | note         ||
| [Build]                                                  | body         ||
| [quest card]                                             +--------------+|
|                          [ one prompt ]                                  |
|            [Axe][Dig][Raise][Level][Garden][Yard][Site][Hands][Plan]     |
+--------------------------------------------------------------------------+
```

- **Top-left `#stock` + `#vitals`:** money, wood and stone as icon chips; stamina and hunger as two icon meters without text labels.
- **Top-right `#hud-top`:** clock chip (day, time), weather chip (`#wxbtn`: icon and temperature; opens the weather drawer), speed as a five-button `.ui-seg` with icons (keeps `data-speed` and `aria-pressed`), gear button. The gear opens `#status`, which becomes the settings drawer: skin tiles, Quality, Graphics, Full screen, Lighting, Models, New world, FPS, seed. Add-ons that append to `#status` (`fx.js`, `fxpost.js`, the kitchen's hint) land in that drawer with no change.
- **Dock `#dock`:** left edge, vertical, 52px icon buttons with a label under each: Bag (I), Shop (U), Hens (H), Home (P), Build (L). Projects (J) is a tab inside Bag. The existing buttons move in with their ids (`#svb-inv`, `#svb-shop`, `#svb-notes` hidden, `#ckb`, `#utb`, `#cvb`), so the views' listeners keep working. A dock button shows pressed while its panel is open.
- **Quest card:** `#cvnext` under the dock as one `.ui-card`; the garden's `#gtip` uses the same card in the same place, one at a time.
- **Drawers:** right side, 400px (Shop and Hens 560px), from under the top bar to above the hotbar; the world stays visible and usable. `#sv`, `#ck`, `#ut`, `#cv`, `#wxpanel`, `#gfxsettings`, `#galm`, `#bschedp`, `#bdesign` all use `.ui-panel`. Small inspector cards that follow a selection (`#gcard`) are `.ui-card` on the left of the drawer area.
- **Bottom lane:** the hotbar row; above it in order the context row (seed cards `.gseeds`, `#svplan`), then the prompt lane holding at most one of `.ghint`, `#reachhint`, `#cvprompt`, `#lock` (restyled as a small prompt). Vehicle messages, `#msg`, `#cvbanner` and `#reachbeat` go to the top toast lane.
- **Build mode:** the build bar replaces the hotbar row. Piece buttons are `.ui-slot` at 56px with the existing category separators; the options strip is a card above the bar; the inspector, schedule and designer are drawers. Dock, quest card and vitals hide while building; money and the top-right cluster stay.
- **Kitchen:** its always-on instructions block collapses to an info button that toggles it; title and readout use tokens.

### Phone and tablet (`body.touch`)

```
portrait                                landscape
+------------------------------+        +----------------------------------------------+
|[=][$4,000]      [08:10 5C][*]|        |[=][$4,000]                       [08:10 5C][*]|
|[energy][hunger]              |        |                                              |
|[quest chip >]    toasts      |        |                                    (Use)     |
|                              |        | (stick)  [mode][slot][slot][slot]    (stick) |
|          [ one prompt ]      |        +----------------------------------------------+
|                        (Use) |
| (stick)              (stick) |
|[mode][slot][slot][slot][slot]|
+------------------------------+
```

- All targets at least 44px; every edge respects `env(safe-area-inset-*)`.
- **Top bar:** menu button (opens the dock as a sheet of large tiles: Bag, Shop, Hens, Home, Build), money chip; right side one chip with time and weather, and the gear. Tapping the time chip shows speed and weather as a sheet (CSS-positioned; `#speed` and `#wxpanel` are not re-parented). Wood and stone are hidden (they are in the Bag). The quest card is a one-line chip that expands on tap.
- **Hotbar:** one row, 56px slots, scrolls sideways, at the bottom edge. Portrait: sticks ride above it. Landscape: the row sits between the sticks and the sticks drop to the corners.
- **Sticks:** 112px, quieter (`--surface-1` at half strength). Peaceful mode shows one `.ui-fab` "Use" button (axe swing) and Jump; the combat buttons get class `cb` so `body.peaceful` hides them. `#cvact` is the same `.ui-fab`.
- **Sheets:** every `.ui-panel` is a bottom sheet (portrait: full width, max 72vh, rounded top, grab bar; landscape: right drawer 360px, full height). While a sheet is open, `body.ui-sheet` hides the sticks, fab and hotbar.
- **Prompts** sit above the sticks; toasts under the top bar.

## 4. Backend refactor: only what is needed

**Doing**

1. **`template/ui/*.css` inlined by `build.sh`.** One place for tokens, components and the frame, without rewriting `head.html`'s style block (other sessions append to it).
2. **`src/engine/ui.js` -> `window.__ui`** (generic, no homestead words, no per-frame work, loaded first among the add-ons):
   - `skin.get()`, `skin.set(name)`, `skin.list`
   - `icon(name)`, `icons.add(map)`
   - `mount(el, lane)` with lanes `'bottom' | 'context' | 'prompt' | 'toast' | 'left' | 'drawer'`: fixed flex containers created once, so bars and prompts stack instead of each computing `bottom: 92px`
   - `panel({ el?, id, title, icon, kind: 'side' | 'modal', wide?, onOpen, onClose })` -> `{ el, body, open(), close(), toggle(), isOpen, note(text, tone) }`. Adopts an existing element or builds the shell. Owns visibility, one-open-at-a-time, Esc for the top panel, `body.ui-sheet`, and the pressed state of its dock button.
   - `dock.add({ id, label, icon, key, panel | onClick, order })`: a new system gets a launcher and a drawer with two calls.
   - `toast(text, { tone, seconds })`, `prompt.show({ key, text, progress })`, `prompt.hide()`
3. **`src/game/hud.js`** (content, loaded last): the homestead HUD wiring. Puts icons on `#tools` buttons by `data-tool` (including the Site button `foundation-view.js` adds), the gear and time chip toggles, the skin tiles, the mode-chip behaviour (a click on the lone pressed `#tools` button in a sub-mode calls `__game.setTool('axe')`). The collapse itself is CSS: `#tools:has(button[aria-pressed="true"]:is([data-tool="garden"],[data-tool="yard"],[data-tool="site"],[data-tool="hands"])) button[aria-pressed="false"] { display: none }`.
4. **Literal colours -> tokens** in `head.html`'s style block and the injected `<style>` strings, by the mapping in step S3. Needed because cozy is a light skin: white-alpha fills and pale state colours vanish on cream.
5. **Views use the kit** for the shell (panel, dock, lanes); their rendering code stays.

**Not doing, and why**

- No file moves or renames, no folder tidy-up (deferred by `ARCHITECTURE.md`; other sessions are editing these files).
- No change to `src/sim/`, the save format, or the sim/engine boundary: views already read state through `__game`, nothing there blocks UI work.
- No rewrite of `src/build.js` or of how `buildui.js` renders from `__build.view()`; build mode gets CSS and slot sizing only.
- No component framework and no template engine: views keep building HTML strings and use kit classes in them.
- `src/engine.js` is not edited. `#status` keeps its id so the engine, `fx.js` and `fxpost.js` keep appending to it.
- Three.js markers, ghosts and overlay colours are world art, not skinned.
- The combat HUD (`#stance`, `#combo`, `.cb`) is left as is, hidden.
- Existing ids, `data-*` attributes, `.hslot`, `.gseed`, `.bchip`, `.btile`, `.bsw` and the `body` mode classes are not renamed.

## 5. Implementation steps

Shared rules: build with `sh build.sh`; run only the listed check; keep diffs in files other sessions edit (`foundation-view.js`, `services-*.js`, `engine/vehicles.js`, `game/vehicles-atv.js`) to the lines named. A step edits only the files it owns. Commit per step, saying what the player would notice.

**Selectors that tests use and must keep working:** `#speed button[data-speed]` (visible and clickable at 1280x720), `#quality` (text `Low`/`High`), `#day`, `#buildbar`, `#bpieces`, `#bopts`, `#bdecor`, `#bsnap`, `#bsched`, `#bschedp`, `#bundo`, `#bredo`, `.bchip`, `.btile`, `.bsw[title]`, `#tools` + `data-tool`, `data-piece`, `#gbar`, `#fbar`, `.hslot[data-slot]`, `.gseed[data-crop]`, `.ghint button[data-buy]`, `#gcard`, `#galm`, `#gtip`, `#glabel`, `#cv`, `#cvbody` (+ `data-act`, `data-opt`), `#cvnext button[data-act^="seen:"]` (clickable on desktop), `#cvprompt`, `#cvbanner`, `#ckbody`, `#help`, `#lock`, `#reachhint`, `#reachsay`, `#physical-kitchen-ui`, `#view`, `#newworld`. `test/shed.clumsy.mjs` line 108 clicks `#newworld`, which moves into the gear drawer: S4 changes that line to `page.evaluate(() => document.getElementById('newworld').click())`.

### Wave 0

**S0 - Plumbing and stubs** (sonnet). Owns `build.sh`, `template/head.html` (lines 1-21 only), new empty files.
- Create `template/ui/00-tokens.css`, `10-kit.css`, `20-hud.css`, `30-hotbar.css`, `40-panels.css`, `41-stock.css`, `50-build.css`, `60-touch.css` (each a one-line comment), and stubs `src/engine/ui.js` (`window.__ui = {};`) and `src/game/hud.js` (empty IIFE).
- `build.sh`: add `engine/ui` as the first name and `game/hud` as the last in both module lists (the `for m in` list and the Python list, where `engine/ui` goes right after `openings-global`). In the Python block, read `template/ui/*.css` sorted by name and insert them as `<style id="ui-css">...</style>` immediately before `</head>` in `h`.
- `head.html`: replace the font link with the Nunito + Fredoka one from section 2; add before the `<style>`: `<script>document.documentElement.dataset.skin=localStorage.getItem('ui:skin')||'cozy'</script>` (wrap in try/catch).
- Done: `sh build.sh && node test/page.smoke.mjs`.

### Wave 1 (parallel)

**S1 - Tokens and component CSS** (opus). Owns `template/ui/00-tokens.css`, `template/ui/10-kit.css`.
- Write both skins' tokens exactly as in section 2, the legacy aliases, and every component in the table. Set `html, body` font to `--font-body` 15px and bare `button`, `input`, `select`, `kbd` defaults from tokens. Bind `.ui-slot` rules to `.hslot`, `#tools button`, `#bpieces button`. Position the six lanes (`#ui-lane-bottom`, `-context`, `-prompt`, `-toast`, `-left`, `-drawer`: fixed flex containers, `pointer-events: none` with `auto` on children, placed as in section 3). Include the selected-slot marker for both skins and `prefers-reduced-motion` (no bob, no bounce).
- Done: build; open `dist/index.html` in Playwright at 1440x900 with each skin (`localStorage['ui:skin']`), one screenshot each; `node test/page.smoke.mjs`.

**S2 - The kit module** (opus). Owns `src/engine/ui.js`, new `test/ui.smoke.mjs`.
- Implement `window.__ui` as specified in section 4.2. Event-driven only; no `requestAnimationFrame` loop. Lanes are created on load and appended to `body` with ids `#ui-lane-bottom`, `-context`, `-prompt`, `-toast`, `-left`, `-drawer`; their positions are CSS written by S1.
- `panel()`: adopting keeps the element's children; if it has no `.ui-panel__head` the kit does not add one. Esc is handled in the capture phase only when a kit panel is open, and stops there.
- `test/ui.smoke.mjs` (same loader as `page.smoke.mjs`): `__ui` exists; switching skin changes `getComputedStyle(document.documentElement).getPropertyValue('--surface-2')` and survives reload; a panel made with `__ui.panel` opens, closes on Esc and closes when a second opens; no page errors; then at 1440x900 and at 390x844 (`hasTouch`, `isMobile`) assert that no two visible elements among `#stock, #vitals, #hud-top, #dock, #tools, #tsl, #tsr, #cvnext` have intersecting rectangles (skip ids not present), and save `dist/ui-<skin>-<size>.png` for the owner.
- Done: `node test/ui.smoke.mjs` (the overlap check may fail on the phone until S9; mark that one check as a warning until then), `node test/page.smoke.mjs`.

**S3 - Literal colours to tokens** (sonnet). Owns the `<style>` block of `template/head.html` (lines 22-566) and the CSS strings in `src/engine.js` (lines ~3427-3447 only), `src/foundation-view.js` (~271-277), `src/services-plan.js` (~42-45), `src/engine/reach.js` (~22-26), `src/cooking/view.js` (~58-66), plus the three `ICONS` maps (`garden-view.js` ~55, `landscape-view.js` ~1195, `foundation-view.js` ~296).
- CSS mapping, value for value, no rule added or removed: `rgba(226,182,90,a)` -> `var(--accent-soft)`; `#e2b65a` -> `var(--accent)`; `rgba(255,255,255,.02-.09)` backgrounds -> `var(--surface-3)`; `rgba(255,255,255,.1-.14)` -> `var(--surface-hover)`; `rgba(255,248,228,..)` -> `var(--surface-3)`; `rgba(0,0,0,.2-.45)` backgrounds -> `var(--well)`; `rgba(22,28,30,.9x)` and `#203027e8`/`ee` -> `var(--surface-2)`; `#1b2326` -> `var(--ink-inv)`; `#b8e08a #cfe3a6 #b9e3a6 #7fa860` -> `var(--good)`; `#f0c080 #e8b48c #f6c79a` and `rgba(240,176,128,..)` -> `var(--warn)`; `#ffc9bd #ffb4a3` and `rgba(224,118,95,..)` -> `var(--danger)`; `#9fe3ff` -> `var(--cad)`; `#dff5ff #e9f9ff` -> `var(--cad-ink)`; `rgba(16,24,30,.92)` -> `var(--cad-bg)`; water meter gradient `#5aa7d8,#8fd0f2` -> `var(--info)`; `#fff4d6 #ffe9a8 #ffe2a0 #fff3c9 #fff0d4` (text on the world) -> `var(--float-ink)`. Leave `#hurt`, `.bport` type colours, `#bmarq` and anything inside `.cb`/`#stance`/`#combo` rules.
- Icons: in the three `ICONS` maps replace each hex in `fill=`/`stroke=` with the nearest `--ic-*` token by material (handles and timber wood, blades and metal steel, plants leaf, water water, earth and compost soil, hands skin, packets and paper paper, rock and concrete and gravel stone, flags and warnings warn, pale outline strokes outline). Do not touch colours passed in as arguments.
- Done: build; `node test/page.smoke.mjs`, `node test/garden.smoke.mjs`.

### Wave 2 (parallel)

**S4 - HUD frame** (opus). Owns `template/head.html` (markup, and deleting the legacy rules it supersedes), `template/ui/20-hud.css`, `src/game/hud.js`, `test/shed.clumsy.mjs` line 108.
- Markup: add `#hud-top` holding the Day/Time pairs (as one clock chip, ids `#day`, `#clock` kept), `#wx`, `#speed` and a new `#hud-gear` button; `#status` keeps the rest and becomes the settings drawer (`.ui-panel--side`, hidden by default, with a skin tile pair at the top). Replace `#svbar`, `#ckbar`, `#utbar`, `#cvbar` with one `<nav id="dock">` containing the same buttons with the same ids, each with an icon and label. Give `#sv`, `#ck`, `#ut`, `#cv` and `#wxpanel` the `.ui-panel` shell classes on their existing head, note and body elements, and turn the text Close buttons into `.ui-close` icon buttons (ids kept). Add icons to the `#stock` items and `#vitals` bars.
- `20-hud.css`: the frame of section 3 for desktop, the `:has()` mode-chip collapse, the quest card, toast and prompt lanes. Delete from `head.html` the old rules for `#stock`, `#status`, `#speed`, `#tools`, `#vitals`, `#svbar`, `#utbar`, `#ckbar`, `#cvbar`, `#msg`, `#lock`, `#shelter` and their media queries.
- `hud.js`: as section 4.3; mount `#tools` in the bottom lane, `#cvnext` and `#dock` in the left lane, `#msg`/`#cvbanner` in the toast lane, `#lock`/`#cvprompt` in the prompt lane; wire the gear to `__ui.panel` over `#status`; register the five dock buttons with `__ui.dock`.
- Done: `node test/page.smoke.mjs`, `node test/ui.smoke.mjs`, `node test/chickens.smoke.mjs`, `node test/shed.e2e.mjs`.

**S5 - Hotbar and context bars** (opus). Owns `template/ui/30-hotbar.css`, `src/engine/hands.js` (`drawBar` only), and the named lines of `garden-view.js`, `landscape-view.js`, `foundation-view.js`, `services-plan.js`, `engine/reach.js`, `engine/vehicles.js`.
- `drawBar`: same attributes and classes, keycap as `<span class="key ui-key">`; nothing else changes.
- Mount `#gbar`, `#lbar`, `#fbar` in the bottom lane beside the mode chip; move each bar's `.ghint` to the prompt lane and `.gseeds` and `#svplan` to the context lane with `__ui.mount`. Delete the duplicated `#fbar .hslot` rules from `foundation-view.js`'s injected style (the shared rules cover it) and the fixed `bottom:` offsets from the injected styles. `reach.js`: mount `#reachhint` in the prompt lane and `#reachbeat` in the toast lane. `engine/vehicles.js` `say()`: call `__ui.toast` when `window.__ui` exists, else the current line.
- `30-hotbar.css`: slot layout for `:is(#gbar,#lbar,#fbar)`, seed cards as `.ui-card`, `#gcard`/`#galm`/`#gtip` as card, drawer and quest card.
- Done: `node test/garden.smoke.mjs`, `node test/landscape.smoke.mjs`, `node test/foundation.smoke.mjs`, `node test/water.smoke.mjs`.

**S8 - Build bar** (opus). Owns `template/ui/50-build.css`, `src/buildui.js` (class names on generated markup only).
- Restyle `#buildbar`, `#bopts`, `#bdecor`, `.bsec`, `.bnumi`, `.bfield`, `.bbadge`, `#blevel`, `#bschedp`, `#bdesign` from tokens: piece buttons 56px slots with 24px icons, options strip as a card above the bar, steppers as `.ui-step`, schedule and designer as `.ui-panel--side`. `.bdim`, `#bsnapm`, `.bhandle`, `.bmeas`, `.bport` keep the `--cad` look in both skins. In `buildui.js` only add kit classes beside the existing ones; change no structure, id or `data-*`.
- Done: `node test/build.smoke.mjs`, `node test/plan-unbuilt.smoke.mjs`.

### Wave 3 (parallel)

**S6 - Bag and Shop** (opus). Owns `src/stock-view.js`, `template/ui/41-stock.css`.
- Use `__ui.panel` (adopt `#sv`, `wide`). Bag: item tiles (icon by category, name, quantity), not a table. Shop: first a grid of category tiles with icons, grouped under five headings (Building, Garden and yard, Home services, Tools, Food); picking one shows its items as cards with name, price per unit, a `.ui-step` and a Buy button; the technical line (density, R-value, strength, dimensions, mass) is behind an info toggle per card, closed by default; a back button returns to the tiles. Money in the head pops on change. Keys I, U, J unchanged; Projects is the third tab. Keep `#svgrant` in the head as a small ghost button.
- Done: `node test/page.smoke.mjs`, `node test/shed.e2e.mjs` (it orders through the Build panel; confirms stock still works), `node test/ui.smoke.mjs`.

**S7 - The other panels** (sonnet). Owns `src/chickens-view.js`, `src/utilities-view.js`, `src/weather-view.js`, `src/construct-view.js` (panel open/close and class names only), `src/cooking/view.js` (its UI block only), `template/ui/40-panels.css`.
- In each view, replace the hand-written `panel.hidden = ...` open and close and the panel's own Esc line with a `__ui.panel` handle (adopt the existing element; keep each view's key and render code; `construct-view.js` keeps its Esc branch for `V.placing`). In generated markup swap bespoke classes for kit ones beside the old names: action buttons `.ui-btn`/`--go`, rows `.ui-row`, cards `.ui-card`, moods and tags `.ui-tag` with tones, meters `.ui-meter`, `#cv .cvseg` `.ui-seg`, checkboxes in `#cv .cvopts` as `.ui-chip` toggles. Kitchen: instructions hidden behind an info button (remembered in `localStorage['ui:kitchen-help']`), tokens for its three boxes. Weather: `#wxpanel` is a side drawer; `#wxbtn` shows an icon from `__ui.icon` by condition.
- `40-panels.css`: only what the kit classes do not cover for these five.
- Done: `node test/chickens.smoke.mjs`, `node test/physical-kitchen.smoke.mjs`, `node test/shed.e2e.mjs`, `node test/construction-tools.smoke.mjs`.

**S9 - Touch** (opus). Owns `src/touch.js`, `template/ui/60-touch.css`.
- Section 3's phone layout: top bar, menu sheet for the dock, time sheet, one-row hotbar, bottom sheets for every `.ui-panel`, quest chip, safe areas, `--hit` targets, both orientations. `touch.js`: add class `cb` to the five combat buttons and the Attack button; add a `.ui-fab` Use button (same `strike` hold) and keep Jump, both shown only in axe mode; compute `--lift` from `#ui-lane-bottom` instead of `#tools`/`#buildbar`, and set it to 8px when the lane does not overlap the sticks horizontally (landscape); hide `#touchui` while `body.ui-sheet` is set.
- Done: `node test/ui.smoke.mjs` with the phone overlap check now a hard failure; `node test/build.smoke.mjs` (it covers the phone controls).

### Wave 4

**S10 - Sweep and docs** (sonnet). Owns `template/head.html` (style block), `ARCHITECTURE.md`, `CLAUDE.md`.
- Delete rules in `head.html` whose selector and properties are fully overridden in `template/ui/*.css` for `#sv`, `#ck`, `#ut`, `#cv`, `#wxpanel`, `#gbar`/`#lbar`, `#buildbar` and the `body.touch` blocks; when unsure, leave the rule. Add to `ARCHITECTURE.md` a short "Interface" section (tokens, skins, `__ui` API, lanes, "a new system adds a panel with `__ui.panel` + `__ui.dock.add`, uses kit classes, no literal colours") and to `CLAUDE.md`'s code map one line for `template/ui/`, `src/engine/ui.js`, `src/game/hud.js` and `test/ui.smoke.mjs`.
- Done: `node test/page.smoke.mjs`, `node test/ui.smoke.mjs`, `node test/build.smoke.mjs`, `node test/garden.smoke.mjs`, `node test/shed.e2e.mjs`. Then the owner playtests both skins on desktop and phone.

| Step | Model | Wave | Title |
|---|---|---|---|
| S0 | sonnet | 0 | Plumbing and stubs |
| S1 | opus | 1 | Tokens and component CSS |
| S2 | opus | 1 | The kit module `__ui` |
| S3 | sonnet | 1 | Literal colours to tokens |
| S4 | opus | 2 | HUD frame |
| S5 | opus | 2 | Hotbar and context bars |
| S8 | opus | 2 | Build bar |
| S6 | opus | 3 | Bag and Shop |
| S7 | sonnet | 3 | The other panels |
| S9 | opus | 3 | Touch |
| S10 | sonnet | 4 | Sweep and docs |
