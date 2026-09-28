# PATHBREAKERS — game design (vertical slice)

An original browser game in the spirit of Rare's *Blast Corps* (N64, 1997), built on my-3dvge as its
tech demo. Research notes: the "design brief" in PR history; this doc is the source of truth.

## Premise and tone
A runaway **Hazard Carrier** hauling two unstable fusion cores is locked on autopilot. It rolls in a
**dead-straight line** at a constant crawl and detonates if it touches anything. You are the
**Pathbreakers** — an emergency demolition crew. Flatten everything in its lane, bridge every gap, and
don't touch the carrier. 90s disaster-movie premise played with a wink: bright colors, chunky voxels,
big booms, radio chatter from "CHIEF" and "SPARKS", country-rock music that turns frantic near a crash.

## Core loop (must keep)
1. **Debrief flyover** of the carrier's line with target buildings marked → 3-2-1 → carrier rolls.
2. Hop between vehicles on foot; each vehicle destroys buildings its own way.
3. **Warnings** escalate per blocking building: arrow color green → yellow → orange → red → dark red,
   then "WARNING!" and "COLLISION IMMINENT!" + alarm; music switches to its tense variant. A radar and a
   HUD arrow point at the next obstacle.
4. The carrier explodes on: touching any building voxel in its lane; reaching an unbridged gap; being
   rammed hard, landed on, or caught in an explosion. Fences, hay and bushes are crushed harmlessly.
5. **Path clear** → off the clock: roam for RDUs, survivors, dishes and 100% destruction. The mission
   ends when the carrier reaches the Safe Zone or you board the **Command Rig** (Semi). Fast-forward
   the carrier once the path is clear.
6. Fail → big double blast → instant retry (no reload).

## Vehicles
| Kind | Name | Destroys by | Action (Shift / X) | Jump (Space / A) |
| --- | --- | --- | --- | --- |
| dozer | PLOWHORSE | Front blade at speed (can't break stone/metal) | Horn; blade grips pushed crates | — |
| truck | TAILWHIP | Armored rear while power-sliding | Hold to slide (assist + highlighted rear zone) | — |
| buggy | SKYLARK | Landing on / crashing into buildings while airborne | Turbo (≈1 s, refilling meter) | — |
| mech | HAMMERHEAD | Stomp dive from the air | Stomp | Thrusters (fuel meter) |
| bike | LONGBOW | Missiles (ranged; opens doors) | Fire (ammo refills) | — |
| train | FREIGHT HOPPER | — (bridges the rail cut with its flatbed) | — | — |
| semi | COMMAND RIG | — (board to end the mission after the path is clear) | — | — |

On foot: walk/run/jump; **E / Y** enters the nearest vehicle and exits. **R / B** puts the vehicle back
on open ground (also recovers from pits and the rail cut). Improvements over the original: drift assist + visible damage zone, ammo that refills, wider
and switchable cameras, instant restart, collision tested against remaining voxels only.

## Puzzles and objects
- **TNT crates**: pushed, not carried; disturbing one lights a fuse (≈8 s, shown above it). Explosions
  chain through other TNT and **gas pumps**.
- **Concrete blocks** fill **drainage pits** in the lane (pushed in with the dozer).
- **Rail cut**: the carrier line crosses a sunken rail line; drive the train until its flatbed is lined
  up (✓ icon) under the lane.
- **Mounds/ramps** launch the truck and buggy.

## Objectives and medals
- **Carrier medal**: gold when the carrier is safe.
- **Completion medal** from buildings %, survivors (8), RDUs (100, lamps that light as you pass, laid out
  as breadcrumb trails to secrets), satellite dishes (2): gold = 100% of all, silver ≥ 75% average,
  bronze ≥ 40%.
- **$ damage** counter (flavor). **Time Attack** (after a first clear): only lane buildings count, gaps
  ignored; bronze 3:30, silver 2:50, gold 2:20, platinum 1:50.
- **Bonus: Quarry Rumble** (unlocked by finding both dishes, or by clearing Cinder Flats): destroy 12
  targets against the clock; 2:30 / 1:50 / 1:25 / 1:00.
- Buildings collapse once ~20% of their voxels' worth of damage is dealt (vehicle hits add bonus damage);
  fences, hay and bushes are crushed by any vehicle (and the carrier) on contact.
- Records and unlocks persist in localStorage.

## Level: Cinder Flats (≈ 360 × 180 m, carrier ≈ 3:20)
Carrier line along +x at z = 0 from x = -165 to the Safe Zone at x = +165 (lane width 3.2 m).
| x (m) | Obstacle | Intended solution |
| --- | --- | --- |
| -140 | fences, hay bales | crushed by the carrier |
| -110, -88 | red barn, farmhouse | PLOWHORSE (start vehicle) rams |
| -60 | gas station (pumps + canopy) between two shops | ram the pumps → chain explosion |
| -20 | rail cut (gap) | FREIGHT HOPPER flatbed lined up under the lane |
| +10 | stone depot (too strong for the dozer) | push TNT from the stack beside it |
| +42, +50 | two drainage pits | push concrete blocks in |
| +75..+100 | terraced houses on grass, dirt mounds | TAILWHIP slides / SKYLARK jumps |
| +130 | 8-storey office tower | HAMMERHEAD stomps (hidden in the shed under the water tower; RDU trail) |
| +165 | Safe Zone + COMMAND RIG | end |
Off-lane: silos, sheds, houses, warehouses, church, garages (for 100%), 8 survivors inside marked
buildings, 2 dishes (one behind the barn, one on the warehouse roof — mech/buggy only), LONGBOW parked
by the depot for opening the mech shed from range.

## Cameras
Overhead (default ¾ chase, like the original) · Chase (low) · Cockpit (first person) · Isometric (fixed
45°, rotate in 90° steps) · Side (2.5D along the lane) · Tactical (top-down). Hold **V** / LB for the
carrier view. In Iso/Side/Tactical, movement is camera-relative (push where you want to go).

## Controls
Keyboard: WASD/arrows drive · Space jump/thrust · Shift or K or left mouse = action · E enter/exit ·
C camera · V carrier view · Z/X rotate iso · R reset vehicle · F fast-forward (path clear) · Esc pause.
Gamepad: left stick drive (RT/LT throttle/reverse also work) · A jump · X/RB action · Y enter/exit ·
View camera · LB carrier view · B reset · D-pad ▲ fast-forward · Menu pause · right stick look.
Touch: left joystick · ACTION, JUMP, ENTER, CAM buttons · pause and carrier view at the top.

## Architecture
- `src/game/sim/` (worker): rules — mission state machine, carrier, vehicles, pickups, level layouts;
  `src/game/sim/art/`: voxel models (vehicles, buildings, props) built procedurally.
- `src/game/client/` (main): camera rig, input mapping, glue; `ui/` HUD + menus + radar; `audio/`
  procedural WebAudio SFX + music.
- `src/game/shared/types.ts`: the contract between them (snapshots, events, input, results).
