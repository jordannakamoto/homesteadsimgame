# Design notes

What the combat prototype settled on, what was tried and thrown out, and what was left open. Written for whoever picks this engine up for another game.

## Principles that survived playtesting

- **No rhythm-game combos.** Timed "perfect" chain windows were tried and rejected.
- **No drawing or gesture inputs.** Flick directions, stroke gestures and steering the blade tip with the mouse all felt like drawing, not swinging.
- **The camera stays high** for a strategy-game read of the fight. The one exception is aiming the bow, which drops to the shoulder. A free camera tilt in melee was rejected.
- **Turning the body must not move the camera.** Driving a cut by turning with the mouse caused motion sickness.
- **Legs and torso are separate inputs.** Force comes from turning one against the other, so the twist lives on its own keys (Q and E). Driving the twist from strafing (A and D) was tried and rejected for merging the two.
- **Slow, deliberate pace**, nearer Kingdom Come and Elden Ring than a hack-and-slash. A faster, harder-hitting tuning was played and called frantic.
- **The bow is deliberate.** You pull the string to make power and stand still for a steady shot; no running and gunning.
- **Challenge from small mixed squads with roles**, not swarms and not pure duels.

## Controls as archived

| Input | Action |
| --- | --- |
| Mouse | Turn the camera; attacks go where it faces |
| W A S D | Move; stepping into a blow adds weight |
| Tap left | Quick strikes |
| Hold left, release | Aimed heavy blow at a ground mark; reach picks chop, slash or thrust |
| Q / E | Twist the torso; twisting with a cut drives it. Alternating driven cuts builds flow |
| Hold right (melee) | Guard; raised within 0.2 s of a yellow attack landing is a parry |
| Hold right (bow) | Aim. Hold Q to pull, release to loose. Alt looses three |
| F | Shove, or throw an off-balance enemy |
| Shift, Shift + Space | Sprint, roll |
| Space | Jump and double jump; left click in the air is a down attack |
| Hold C | Crouch for stealth |
| Wheel or R | Stance: zoomed in for melee, out for the bow |

Open problem: the left hand does movement, twist and everything else, and tires. Ideas not yet built: twist on the mouse thumb buttons, or making sprint and crouch toggles.

## Enemies

Each has health and a posture bar; filling posture staggers it. Yellow glow means the attack can be parried, red means it cannot. Numbers live in `MOVES`, `MOVESET` and `KIND`.

| Kind | Role |
| --- | --- |
| 0 Grunt | Basic melee. Some are flagged to flank |
| 1 Shield-bearer | Blocks from the front except mid-swing; several from one camp advance abreast as a line |
| 2 Archer | Keeps its distance, stands behind a shield line if there is one |
| 3 Brute | Large, slow, red slams and wide sweeps; cannot be thrown; ignores the taunt |
| 4 Skirmisher | Fast; circles to the target's back, stabs, hops out. Hits from behind do 30% more and cannot be guarded |
| 5 Spear | Second rank; long, very narrow thrust past the shields |
| 6 Shaman | Marks a ground circle that erupts 1.6 s later and cannot be blocked; every third cast heals and enrages an ally |

Group rules in `updateEnemies`: one melee attack wound up at the player at a time (two when six or more are awake) with at least 0.9 s between starts; waiting enemies spread around the target; enemies step into their swings and lunge in a straight line, so backing straight off fails and a late sidestep works; an enemy mid-swing is braced against knockback.

## Allies and camps

Two companions, a Guardian (shield, taunt, stays near the player) and an Archer (hunts the enemy back rank). Out of combat they pick their own spots around the player, walk round trees, drift and look about when the player stops, and fall in behind when unaware enemies are near. They go down and get back up after the fight.

Four camps are placed around the start, each a fixed squad in formation (`CAMPS`): the shield wall, the ambush, the brute, the hexers. A camp left unfinished when the player dies is restored to full strength.

## Left unfinished

- Difficulty was never settled. The last tuning (slower, softer) was not played before the project changed direction.
- The full fight simulations were not rerun after the last three tuning passes.
- Enemies have no line of sight and give up only on distance.
- Wild enemies in chunks are still only grunts and shield-bearers.
- An outside critic's review found these and they are fixed: backing away beat every attack, thrown bodies could not reach a brute, dying let you wear a camp down, arrows used a fixed lead. Not addressed from that review: allied hits and taunts interacting oddly with posture in edge cases.
- No saving of progress beyond the in-memory world diff; no multiplayer.
