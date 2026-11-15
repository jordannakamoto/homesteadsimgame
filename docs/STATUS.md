# Run status

The single place to see where the V1 run stands. Updated by the orchestrator at every merge.

**Standing orders (set 14 Nov 2026, 19:20 Pacific):** the owner is away for about 8 hours. Work through as many waves as possible without waiting for approval. Keep every merged wave playable on the live page, with its section in `docs/PLAYTEST.md`. Stop only for something that blocks all progress or an irreversible decision that could go either way.

## How to playtest and critique

- The live page always holds the newest merged wave. Each wave is also a commit on `main` listed below, so any wave can be rebuilt (`git checkout <commit> && npm install && sh build.sh`).
- `docs/PLAYTEST.md` has one section per wave: what is new, what to try, known gaps.
- Write critiques in `docs/FEEDBACK.md` (a template is there), or just say them in chat. Feedback is read before each wave starts and answered in the next wave's playtest notes.

## Waves

| Wave | Iterations | State | Commit on `main` |
|---|---|---|---|
| A | 0 simulation spine | Merged, live | `68c7226` |
| B | 1 weather, 2 materials, 2a build mode (first half) | Merged, live | see `git log` for "Wave B complete" |
| C | 3 structure, 4 thermal, 6 electrical, 7 water, 13 chickens, 2a build mode (second half) | In progress | |
| D | 5 heating and moisture, 5a interiors, 5b camp and journal, 8 soil and irrigation, 14 chicken lifecycle, 18 salvage and renovation | Not started | |
| E | 9 crops, 19 contractors, 20 automation | Not started | |
| F | 10 soil and compost, 11 greenhouse, 12 hydroponics, 15 goats, 16 kitchen | Not started | |
| G | 17 dairy and workshop, 21 inspector and blueprints | Not started | |
| H | 22 integration | Not started | |

## Open questions for the owner

Things decided on the owner's behalf that are easy to reverse. Say so if any is wrong.

- A day at 1x takes 20 real minutes (it was 10).
- Log and timber-frame construction are in V1; stone masonry, cob, earthbag and yurts are deferred.
- The default climate is temperate at about 45 degrees north, so there are four real seasons with snow. Other climates exist as presets.
- Starting money is a placeholder until prices and the pace of play can be felt.

## Deviations from the plan

- The run stopped from about 7:25pm to 8:35pm Pacific on 14 Nov when the usage limit was reached, then restarted itself.
- Another session pushed two fixes to `main` during wave B (dollhouse view, potted plant on High); they are merged in.

- Wave tags could not be pushed from the build environment; waves are identified by commit instead.
- Iteration 2a was split across waves B and C.
