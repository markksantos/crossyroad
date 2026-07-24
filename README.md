# Chicken Cross

A complete Crossy Road clone in Three.js. No build step, no assets — every model is
procedural boxes and every sound is a WebAudio oscillator.

## Run

```bash
./serve.sh          # http://localhost:8181
```

Any static server works; it must be served over http (ES modules + importmap won't
load from `file://`).

## Controls

| Input | Action |
|---|---|
| `W` `A` `S` `D` / arrow keys | hop forward / left / back / right |
| tap | hop forward |
| swipe | hop in that direction |
| `space` | start / retry |

## What's in it

- **Endless procedural rows** in bands — grass, roads, rivers, railways — with a hard
  rule that hazards never run more than five rows deep.
- **Traffic** — cars and trucks at per-row speeds and directions, evenly spaced so they
  never bunch up at the wrap seam.
- **Rivers** — drifting logs you ride (with the current), plus static lily-pad rows.
  Drift off the edge of the world and you're gone.
- **Railways** — signals blink and a bell rings before an express train comes through.
- **The eagle** — the camera creeps forward once you're moving; dawdle and you get taken.
- **Coins**, a persistent best score (`localStorage`), squash / splash / snatch death
  animations, screen shake, and horn, bell and crash sounds.
- Rows are recycled behind the camera, so memory stays flat on a long run
  (~50 rows live, ~26 MB heap, 60 fps).

## Layout

| File | Role |
|---|---|
| `index.html` | canvas, HUD, start / game-over cards, importmap |
| `src/main.js` | renderer, camera rig, game loop, input, HUD wiring |
| `src/world.js` | row generation, traffic / logs / trains, collision queries |
| `src/player.js` | hop tweening, log riding, death animations |
| `src/models.js` | procedural models over cached geometries and materials |
| `src/audio.js` | WebAudio sound effects |
| `src/constants.js` | tuning values |

`window.__cc` exposes `{ player, world, camera, scene, renderer, state }` for poking at
the game from the console.
