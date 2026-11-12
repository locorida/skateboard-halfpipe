# Skateboard Halfpipe

A small 3D skate game on canvas with two parks: a wooden halfpipe and a concrete street park with a rail and a ledge. Ride a skateboard or a stunt scooter, pump for speed, fly over the coping and land spins, kickflips, tailwhips and grabs. One session lasts 60 seconds.

**[Play it in the browser](https://locorida.github.io/skateboard-halfpipe/)** · English and German · keyboard and touch

![Screenshot](docs/shot.png)

## Features

- **3D without a library.** About 900 lines of plain JavaScript: a small perspective projection, a painter's algorithm for the ramp surfaces and simple flat shading. The camera follows the rider and rises with big airs. No WebGL, no images, no build step.
- **Real pumping.** Speed doesn't come from a button. Crouch while riding down a wall, stand up in the bottom curve, and the timing decides how much speed you gain. Staying crouched uphill costs speed, so mashing ↓ doesn't work.
- **Physics in metres.** The rider moves along the ramp profile (3.2 m transitions, a funbox in the middle), flies ballistically after an ollie and goes straight up over the coping. Gravity, rolling resistance and drag are real; landings are a bit forgiving, like bending your knees.
- **Street park with grinds.** Ollie onto the rail or the ledge: straight for a 50-50 (5-0 on the ledge), turned 90° for a boardslide, feeble or grind on the scooter. You never land perfectly centred, so you steer with ← → to keep your balance, then roll off the end or ollie out.
- **Banners, graffiti and a crowd.** Made-up skate brands on a fence behind the halfpipe and on the brick wall of the street park, graffiti on the quarter pipes and the funbox, a few marker tags on the wooden halfpipe. A mountain bike leans against the halfpipe and three people watch from its decks. In the street park a few skaters watch from the wall: they clap after a trick, throw their arms up for big ones and hold their heads after a bail, and a black and white dog trots around, wags its tail and barks.
- **Tricks and combos.** Spins in steps of 180°, kickflips (skateboard) or tailwhips (scooter), grabs. Land straight with the flip finished or you bail. Tricks in a row build up a combo up to ×5.
- **Accessible where it can be.** Keyboard controls, focusable canvas, on-screen buttons on touch devices, and an `aria-live` region that announces tricks, bails and the final score. Light and dark page theme.
- **Best score** saved in `localStorage` (optional; the game works without it).

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Drop in / ollie | Space | Tap the game or *Jump* |
| Pump (hold riding down, release at the bottom) | ↓ or S | ▼ |
| Spin in the air | ← → (A D) | ⟲ ⟳ |
| Kickflip / tailwhip | ↑ or W | ▲ |
| Grab | hold ↓ in the air | ▼ |
| Push on flat ground | ← → | ⟲ ⟳ |
| Keep balance on a rail | ← → | ⟲ ⟳ |

## Tested balance

`npm test` runs `sim/balance.js`: bots play the real game code (loaded with a stubbed DOM) for full sessions, with different play styles and human-like timing errors, and the run fails if the game doesn't behave as intended:

```
idle            first air over coping    – | max height 0.0 m | score     0 | bails 0
holds down      first air over coping    – | max height 0.0 m | score     0 | bails 0
pumps, exact    first air over coping  3.3 s | max height 2.5 m | score  2149 | bails 0
pumps, ±0.2 s   first air over coping  3.4 s | max height 2.5 m | score  1869 | bails 0
tricks, good    first air over coping  3.3 s | max height 2.5 m | score 19018 | bails 1
tricks, sloppy  first air over coping  3.3 s | max height 2.4 m | score  5413 | bails 3
street, airs only   first air over coping  4.1 s | grinds  0 | score  1350 | bails 0
street, grinds      first air over coping  4.2 s | grinds 10 | score 18781 | bails 0
street, no balance  first air over coping  8.6 s | grinds  3 | score  1901 | bails 3
```

The simulation found the main tuning problem: the funbox used to launch riders automatically and ate about a third of their speed on every pass, so pumping never paid off. Now you roll over it unless you ollie.

Requires Node 18 or newer, no `npm install` needed. It runs on every push via GitHub Actions and takes about a second.

## Run locally

Open `index.html` in a browser. `?lang=en` or `?lang=de` picks the language (otherwise the browser language decides).

## Embedding

The game needs a `<canvas id="halfpipe" width="960" height="540">` and optionally a status element `#halfpipe-status` with `aria-live`. Texts can be passed as JSON in `data-texts` on the canvas (German is the default). Load `halfpipe.js`; `window.Halfpipe.setVehicle('skate' | 'scooter')` switches the ride, `window.Halfpipe.setPark('pipe' | 'street')` the park (each park keeps its own best score) and `window.Halfpipe.press(key, down)` wires up your own touch buttons. See `index.html`.

## License

[MIT](LICENSE)
