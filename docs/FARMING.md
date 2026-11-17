# Farming: Harvest Moon, if it were real

The design for the farming pillar (iterations 8 soil and water, 9 crops, 10 soil fertility and compost), written after the owner asked for farming to be a big, playtestable system: "like Harvest Moon if it were realistic". This is the brief for whoever implements it. It follows the same rule as construction: real reasons, simple hands.

## The idea in one paragraph

Keep what makes Harvest Moon work: a small plot you tend every day, a few clear verbs (till, sow, water, weed, harvest), plants that visibly change, seasons that matter, and the pleasure of a tidy field. Replace its arbitrary rules with real ones: crops grow on warmth and light, not a day counter; you water because the soil is dry, not because the game says once a day; the season decides what you can plant because frost kills tomatoes; soil gets tired and compost restores it. The player should come away knowing when to plant peas and why their tomatoes failed.

## What is kept from Harvest Moon, and what is made real

| Harvest Moon | Here |
|---|---|
| Till a tile, sow a seed, water daily | Same verbs. Beds are drawn any shape; a bed is a grid of 30 cm cells underneath |
| A crop takes N days | A crop needs a sum of warmth (growing degree days). A cool spring is slow, a hot June is fast |
| Each crop belongs to a season | Each crop has a temperature range and frost tolerance. The season follows from the weather, and a greenhouse or row cover changes it |
| Water every day or it does not grow | Soil holds water. Rain fills it, sun and plants empty it. You water when it is dry. Sandy soil dries fast, clay holds on |
| Fertiliser is a speed boost | Plants take nitrogen, phosphorus and potassium from the soil. Heavy feeders deplete it; legumes add nitrogen; compost puts it back |
| Crops are sold for gold | Crops are food: eaten, stored, preserved, fed to animals, saved as seed. A roadside stand comes later |
| Stamina limits the day | Daylight and your own interest limit the day. Tools and irrigation remove chores as the plot grows |
| Festivals and villagers | Out of scope |

## What is real and what is abstracted

| Real | Abstracted |
|---|---|
| Growth from temperature, light, water and nutrients | Individual leaves and roots: one plant has a growth stage and a few numbers |
| Frost dates, heat stress, bolting in heat | Plant diseases beyond a simple damp-and-crowding risk |
| Soil water by soil type, rain, evaporation and drainage | Soil layers: one root zone per cell, with a deep reserve |
| N, P, K and pH, organic matter | Micronutrients and soil biology |
| Days to maturity that match seed packets in a normal season | Pollination: assumed, except that corn wants a block and squash wants bees (a note, not a mechanic) |
| Spacing: crowded plants yield less | Thinning and transplanting are one action |
| Weeds compete for water and nutrients | Weed species |
| Yields per square metre in a realistic range | Pests: a light, visible, preventable pressure (fence for deer and rabbits) |

## The model

One system, `garden`, on a slow cadence (soil water hourly, growth every three hours). State is a set of beds; each bed has cells; each cell has soil and at most one plant.

**Soil water.** A bucket per cell for the root zone: field capacity and wilting point from soil texture (sand, loam, clay), filled by rain and irrigation, emptied by evapotranspiration and drainage. Evapotranspiration from the weather (a Hargreaves or Priestley-Taylor reference rate) times a crop coefficient that grows with the canopy. Mulch cuts evaporation. Water stress begins when the bucket falls below a crop's comfort fraction.

**Growth.** Thermal time: each crop has a base temperature, an optimum and a ceiling, and a degree-day total for each stage (germination, seedling, vegetative, flowering, fruiting, mature, past it). Daily growth is thermal time scaled by the worst of four limits, each from 0 to 1: water, nitrogen, light (day length and shade from buildings and trees, using the real sun), and crowding. Biomass and yield accumulate from intercepted light (a radiation-use efficiency), so a stressed plant matures on time but yields less, as real ones do.

**Cold and heat.** Frost damages or kills by tolerance class (tender: tomato, squash, beans; half-hardy: lettuce, potato; hardy: kale, peas, garlic). Heat above a ceiling causes blossom drop in tomatoes and bolting in lettuce and spinach. Last and first frost dates are not rules; they are what the weather does, and the almanac panel tells the player the typical dates for their climate.

**Nutrients.** Each cell tracks plant-available N, P and K, organic matter and pH. Crops take up in proportion to growth, with a per-crop demand. Legumes fix nitrogen. Residues left on the bed return some. Compost and manure add organic matter that releases nutrients over months. pH outside a crop's range locks nutrients up.

**Weeds.** A weed cover fraction per cell that creeps up with warmth, water and bare soil, and takes its share of water and nitrogen. Hoeing or mulching resets or suppresses it.

**The first crops.** Chosen to teach different things, with real figures for each (base temperature, degree days, spacing, water need, yield per square metre, frost class, feeding class, storage life):

| Crop | Why it is in the first set |
|---|---|
| Radish | Three to four weeks: the first win |
| Lettuce | Cool season; bolts in heat |
| Peas | Plant early; fixes nitrogen; climbs |
| Potato | Storage crop; hilling; the first frost ends it |
| Tomato | Tender; long season; heavy feeder; the crop everyone wants |
| Bush bean | Warm season; fixes nitrogen; fast |
| Carrot | Slow to germinate; stores in the ground or the cellar |
| Winter squash | Sprawls; stores for months |
| Kale | Survives frost; food in winter |
| Garlic | Planted in autumn, harvested next summer: patience |
| Sweet corn | Wants a block; a heavy feeder that shows tired soil |
| Wheat | A field crop: the bread chain later |

Later: fruit trees and berries (years to bear), herbs, onions, cabbage, cover crops as a tool.

## The loop, day by day

1. **Make a bed.** Till it: pull the hoe through the grass, stroke by stroke. The bed is whatever you have worked. Raised beds are a build-mode piece filled with bought or home-made soil.
2. **Read the soil.** Squeeze test for texture and a simple test kit for pH and nutrients. The bed shows its state as colour and words, not a table.
3. **Sow.** Pick a seed packet; the ghost shows spacing; drag to sow a row or fill a block. The packet says when to sow in plain words for your climate ("after the last frost, usually mid May here").
4. **Tend.** Water when the soil looks dry (it visibly darkens when wet and pales as it dries). Hoe weeds. Stake tomatoes, hill potatoes. A morning walk round the garden takes a few minutes.
5. **Watch.** Seedlings come up in days. Plants pass through recognisable stages. Trouble shows on the plant: wilting, yellow leaves for nitrogen, purple for cold, burnt edges for frost.
6. **Harvest.** Each crop has its own gesture and its own best moment; some keep producing. Harvests come as gluts.
7. **Put the bed to rest.** Pull the plants, compost them, spread compost, mulch or sow a cover crop for winter. Rotate what goes where next year.

### Seeing it without numbers

- Soil colour shows moisture. Plant posture shows thirst. Leaf colour shows hunger or cold.
- A calendar strip for each sown crop: where it is between sowing and harvest, and whether it is ahead or behind for the weather.
- An almanac panel: typical last and first frost, what can be sown now, what is ready soon.
- Click any plant for the plain-language reason behind its state ("Growing slowly: the soil has been dry for four days").

### Keeping it from being a chore

- Watering is quick: a can waters a swathe, not a tile; a hose more; then drip irrigation on a timer removes it. The player graduates from chores by building, which is the point of the game.
- Mulch cuts weeding and watering. Good soil cuts feeding.
- Nothing needs doing every single day. Soil holds a few days of water; a missed day costs growth, not the crop.
- Tools change the size of a gesture: hand hoe to wheel hoe to tiller; can to hose to drip.

### Being forgiving

- A failed crop always says why, and the bed can be resown the same day.
- Frost is forecast the evening before by the almanac ("clear and still tonight: frost likely"), and a row cover is one action.
- The first radishes are nearly impossible to fail.

## Controls (as built: gardening with your hands)

Press **5** to take up the garden tools. The camera comes in close, you walk as usual (WASD, a little slower), and a small hotbar shows what you can hold: Hands, Hoe, Can, each seed packet you own, Straw and Compost when you have them, and the Seed box (where packets, straw and compost are bought). Number keys, the wheel or a click change what is held, and it is shown in the character's hands. The mouse aims a marker on the ground, clamped to arm's reach (1.5 m, the faint circle); the character turns to face it. Right-drag turns the view. Esc or 5 puts the tools away.

One gesture per job, each forgiving about direction and length:

- **Hoe: till and weed.** Press the blade into the ground and drag it toward you; every 30 cm square the blade passes is worked once per stroke. Grass becomes rough, clod-strewn sod on the first stroke and fine, furrowed, darker soil on the second (three with only the shovel). There is no bed tool: a bed is the ground you have worked. Under the hood `garden.till` grows the touching bed or starts one, and joins beds that come to touch. On worked soil the same pull cuts weeds.
- **Can: tip to pour.** Hold the button to lift the can over the marker, drag the mouse down (or hold the right button) to tip it; the further it tips the faster it pours. Walk or sweep along the row while it pours. Fill it at a water fixture (hold the can at a tap or tank; at a hand pump, each drag down and release is a stroke of the handle and draws real water with `water.draw`), or dip it in a pond. A labelled temporary "Fill it here" button appears only when the can is empty and the world has neither.
- **Trowel: open the soil.** Drag its tip along the row to draw a drill (a shallow groove); tap for a planting hole. Potatoes, garlic, squash and tomatoes go in holes; everything else in a drill or a hole (`garden.open`).
- **Seed: drop along the row.** Faint dots show the packet's spacing on the open drills and holes around the marker. Click to drop a pinch into a square; hold and drag to sow square after square as your hand passes. Seed takes only where the soil is open (`garden.sow` with `inOpening`), and sowing covers the opening.
- **Shovel (shared with the Yard, key 6):** dig holes, heap hills and raised rows on the bed. The bed follows the shape of the ground, and the shape matters: rain runs off hills into basins, a hill warms sooner, a hollow is a frost pocket. Pulling the hoe past potatoes hills them.
- **Hands: harvest and tend.** Root crops: press on the plant and pull upward. Leaf and grain crops: a sideways swipe, which carries on along the row while held. Fruiting crops: click to pick, the plant stays. The first harvest of each crop, and any haul over 1.5 kg, is held up overhead for a beat with its name; later ones get a quick lift. Shift with the same motion pulls out an unripe plant; spent or dead plants come out without it.
- **Straw and compost:** hold and sweep the bucket over the bed.
- **Look.** Pointing at a plant shows a name tag with one plain line. **F** opens the full card for the plant or bed under the marker; **N** opens the almanac.

Touch: one finger aims and drags the same gestures near the character; two fingers turn the view; the hotbar is tapped.

The generic part is `src/engine/hands.js` (`window.__hands`): the hotbar, reach-limited aiming, the gesture measures (pull, travel, tip, lift, sideways), posing the held object, holding something overhead, and `pick(objects)` for targets that are not ground. It knows nothing of gardening; `src/garden-view.js` supplies the slots and handlers through `__hands.open()`.

## The first garden: a guided project

A project card, "Grow your first salad", optional and skippable: make one small bed, sow radish and lettuce, water it, and eat it about four weeks later. It teaches bed, sowing, watering by soil colour, and harvest. It opens the next cards: "Plant after the frost" (tomatoes and beans) and "Something for winter" (potatoes, squash, kale).

## How it ties to the rest of the game

- **Weather** drives everything: temperature, rain, sun, frost, wind drying the soil.
- **Water** (iteration 7): irrigation draws from tanks and taps; greywater feeds a tree.
- **Thermal** (iteration 4): a greenhouse or cold frame is just a building whose inside air the plants live in.
- **Animals:** chickens eat scraps and garden waste, their manure and bedding become compost, a chicken tractor fertilises a resting bed.
- **Kitchen and pantry:** the harvest becomes meals and stores. The pantry going into winter is the year's payoff.
- **Stock and store:** seeds, tools, amendments. A seed aisle that is small in spring and grows with what the player has grown.
- **Build journal and ledger:** yields per bed, what share of the household's food came from the garden.

## Engine and game

Generic: a field of cells with per-cell state and a brush-based interaction for acting on swathes of them; a thermal-time growth model taking crop records; a bucket soil-water model taking soil records. Content: the crops, soils, amendments, cards and almanac text.

## Order of building

1. Soil water, the growth model and the first twelve crops, headless, with tests against known figures (days to maturity in a normal season for each climate, water use, yields per square metre, frost kills tender crops, legumes add nitrogen).
2. The playable loop: beds, sowing, watering, visible stages, harvest, the plant inspector, the first-salad card.
3. Fertility: nutrients, compost, rotation, weeds, mulch.
4. Irrigation from the water system, the almanac, row covers and cold frames.
