# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

"Leuchtturmwärter": a 2–4 player co-op browser game (pixel-art ship cross-section, PixiJS v8 + Rapier2D, Colyseus online play). Code and comments are English; docs (`README.md` = public GitHub page, `DECISIONS.md`, `PLAN.md`, asset README) and all in-game text are German. Record non-obvious design decisions in `DECISIONS.md` and progress in `PLAN.md`. Detailed developer notes (controls, debug keys, hosting, known issues, manual tests) live in the gitignored `NOTIZEN.md` (local only).

## Commands

```bash
npm install
npm run dev            # game server (:2567, tsx watch) + Vite client (:5173, --host); refuses to start if a port is busy, auto-runs npm install when deps are stale
npm run dev:client     # only Vite;  npm run dev:server  # only the Colyseus server
npm run typecheck      # tsc --noEmit for every package (shared has NO DOM types)
npm test               # vitest in shared/, client/, server/ (server tests open real WebSocket connections)
npm run build          # typecheck + vite build of the client
npm run assets         # regenerate placeholder art + sounds (keeps hand-replaced files; assets:force overwrites)
npm run verify         # Playwright: starts servers, screenshots to screenshots/, 2-browser online round, FPS (Chromium; WebKit if installed)
```

Single test file / test name (run inside the package dir):
```bash
cd shared && npx vitest run test/voyage.test.ts
cd shared && npx vitest run -t "kraken"
```
`node scripts/net-lag.mjs 200` (with `npm run dev` running) measures prediction feel under artificial lag. Useful URL params: `?solo` (skip lobby), `?debug`, `?quality=high|medium|low`, `?sea=0.8`, `?server=wss://…`, `?lag=150`, `?room=ABCD`, `?tune`.

TypeScript is 7 (native `tsc`), used only for type checking; Vite/tsx transpile. Playwright is pinned to the preinstalled Chromium — do not run `playwright install`. Headless FPS numbers come from SwiftShader and are not representative.

## Architecture

npm workspaces: `shared/` (simulation, no DOM, exported as TS source via `exports: ./src/index.ts`), `client/` (Vite + PixiJS), `server/` (Colyseus, runs with `tsx` directly from TS, also in production/Docker).

**Simulation (`shared/src/simulation.ts`)** — `Simulation.step(inputs, dt, commands)` is the only way the game advances: inputs (`PlayerInput`, per player id) and `SimCommand`s are plain data, `sim.state` (`GameState`, `state.ts`) is plain serialisable JSON. Fixed 60 Hz (`FixedStepper`), seeded RNG in the state, no `Math.random` in `shared/`.
- The ship is NOT a physics body. Everything inside is simulated in ship-local coordinates (meters, y down, 0.5 m tiles); gravity is rotated by −roll instead. Rendering rotates the ship container; the sea is in world space.
- The ship is an ASCII map (`layout/shipMap.ts`); `parseLayout` derives colliders, light occluders, ladders, hatches, water compartments, leak points and markers. Hull PNGs must match the map size (72×27 tiles).
- **All mutable state must live in `GameState`** (incl. controller internals like jump buffer, object angular velocity, cooldowns). `Simulation.loadState()` rebuilds the Rapier world from a state — online prediction depends on this. Adding a field to the state also requires adding it to the codec schema (`net/codec.ts`; the typed schema makes a missing field a compile error, `codec.test.ts` round-trips everything).
- Gameplay numbers are data: `tuning.ts` + `tuning.json` (applied via the `tune` command). Client-only look values: `client/src/look.ts` + `look.json`. The in-game panel (F9) saves both via a Vite dev-server endpoint (`client/vite.config.ts`).
- Phase 4 content (voyage/storm, rocks with a sideways `lateral` position, searchlight spotting, cannon balls in world coords, kraken state machine, pings, automatic shouts, arrival) is in `simulation.ts`; lane/threat math shared by sim and sea chart is in `navigation.ts`.

**Networking (`shared/src/net/`)** — authoritative server + client-side prediction, no Colyseus schema state:
- `protocol.ts`: message names, packed inputs (`[firstSeq, bits, target, …]`), validation of everything from the network, room codes. Bump `PROTOCOL_VERSION` on incompatible changes (server rejects other versions in `onAuth`).
- `host.ts` (`ShipHost`, server side, Colyseus-independent): per-player input queues with jitter buffer, one input per tick, acks, collects events, builds snapshots.
- `predict.ts` (`Predictor`, client side): applies own input immediately, on each snapshot `loadState` + replays unacknowledged inputs; remote players repeat their last input. Own events come from prediction, everyone else's from server events.
- `codec.ts`: binary snapshot encoding (~0.8 KB).
- `server/src/ShipRoom.ts`: one room per ship, roomId = 4-letter code, 60 Hz with its own `performance.now()` timing (Colyseus' tick delta is unreliable), 20 Hz snapshots, host-only debug/tune commands (pings allowed for all), `onDrop`/`allowReconnection`.
- Client: `client/src/net/NetLink.ts` (SDK wrapper, reconnect token in sessionStorage, `?lag`), `config.ts` (server URL: `?server` → `VITE_SERVER_URL` → dev: same host :2567), `game/Game.ts` `goOnline()`; corrections are faded as visual offsets (`game/snapshot.ts`).

**Rendering (`client/src/render/`)** — low-res (~480×270) passes with integer nearest upscale: albedo → normal (per-sprite meshes, `LitSprite`) → mask → light (visibility polygons per light against tile occluders, additive) → composite shader (ambient, posterised light + Bayer dither, fog, sky) → upscale. Every pass has the same world/ship container hierarchy (`GameRenderer`). Quality levels with automatic fallback below 50 fps. Avoid Pixi's built-in uniform names (`uColor`, …) in custom shaders. World hazards (`HazardView`) sit between the far and near sea layers.

**UI/input** — HUD is pixel art in the low-res buffer (`ui/Hud.ts`, `SeaChart`, `StationWidget` with drag-able wheel/lever/dial producing `PlayerInput.target`); lobby/menu/tuning panel are DOM. Touch controls are canvases sized in game pixels; iOS zoom gestures are blocked except inside `.allow-touch` elements.

**Audio** — `client/src/audio/AudioEngine.ts` (Web Audio, unlocked on first gesture, `_1/_2` variants, missing files stay silent) and `GameAudio.ts` (maps events/state to sounds by distance).

**Assets** — `scripts/generate-assets.ts` draws all placeholder PNGs (+ `_n.png` normal maps, Aseprite-format JSON) and synthesises WAVs (`scripts/assets/synth.ts`, `sfx.ts`) into `client/public/assets/`. A hash manifest (`.generated.json`) protects files the user replaced by hand. Conventions for replacements: `client/public/assets/README.md`.

## Deployment
Client: static Vite build (Vercel, needs `VITE_SERVER_URL=wss://…`). Server: `server/Dockerfile` (build from repo root) + `fly.toml`; rooms live in memory, so exactly one machine (`fly deploy --ha=false`). After changes to `shared/` or `server/`, server and client must be redeployed together.
