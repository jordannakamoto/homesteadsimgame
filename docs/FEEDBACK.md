# Feedback

Write anything here, as roughly as you like. It is read before each wave starts. Answered items move to the bottom with what was done.

## New

<!-- Example:
- Wave B, build mode: the options strip is too small on my monitor.
- Weather: winter feels too long.
-->

## Answered

- **15 Nov, owner.** Plumbing and electrical "aren't quite there yet" for Nintendo-level intuition plus real-world gestures; construction still feels like the Sims build mode when the aim is laying things by hand so the player learns how to build in real life. Done: "The hands rule" added to `docs/V1_PLAN.md`; the construction agent redirected to setting and nailing pieces by hand; hook-ups redesigned to be done by hand in `docs/CONSTRUCTION.md`.
- **15 Nov, owner.** The starting plot needs water for the watering can: a spigot or a well. Done: every new world now has a dug well, a hand pump and a spigot near the arrival point.

- **15 Nov, owner, after playing the garden.** "Not really intuitive on a game level like Stardew Valley, and not realistic feeling with the controls and interactions." Chose: in the body and mouse-aimed; hands-on gestures combined with simplified Nintendo style (hold items overhead like Zelda); actually till the bed instead of holding on an area. Done: recorded in `docs/FARMING.md` "Controls"; garden controls being rebuilt on that basis.
- **15 Nov, owner.** Wants an intuitive UI for laying wires and pipes. Done: designed in `docs/CONSTRUCTION.md` "Hooking things up"; iteration 6a added, to follow the construction loop.
- **15 Nov, owner.** Prefers to playtest things themselves over long automated verification. Done: merges now go out on tests plus one quick look.

- **15 Nov, owner.** Farming is a big system to playtest: "Harvest Moon if it were realistic". Done: `docs/FARMING.md` written; farming promoted to run alongside construction.
- **15 Nov, owner.** Make mechanisms such as vehicles game-agnostic so the engine can be reused. Done: rule and table in `ARCHITECTURE.md`.
- **14 Nov, owner.** Digging and laying pipes for sewage, water and power; renting excavators and similar machines. Done: designed in `docs/CONSTRUCTION.md`; iterations 7a and 7b added.

- **14 Nov, owner, after wave B.** Build mode feels like a design mode; wants it to feel like building with lumber, with realistic foundations and walls, deliveries dropped near the player, and assembly by hand. The supplier is overwhelming; wants something like an in-game hardware store that teaches what to buy, with unlocks. Weather needs to be readable visually.
  Done: recorded as a direction change in `docs/V1_PLAN.md` with three new iterations (2c construction, 2d store and plan book, 1a weather you can see). The build mode agent in wave C was redirected to produce real framing, foundations, build stages and the materials list that construction needs. These three iterations lead wave D.
