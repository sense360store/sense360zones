# Sense360 Zone Studio

An interactive radar/sensor **zone-configuration studio** for Sense360 rooms.
Lay out detection and exclusion zones over a live radar canvas, tune sensor
range bands, and watch tracked targets move in real time.

This is a faithful React implementation of the Claude Design prototype
`Zone Studio.dc.html`.

## Features

- **Two sensor layers**
  - **HLK LD2450** — spatial X/Y tracking (120° FoV, up to 3 targets). Owns the
    drawable detection/exclusion zones.
  - **DFRobot SEN0609 (C4001)** — radial range band (single distance +
    presence). Tunable inner/outer radius, beam width, and sensitivity.
- **Canvas** — range rings, radial spokes, sensor field-of-view, live animated
  targets with motion trails, and a 0.5 m snapping grid.
- **Drawing tools** — Select, Rectangle, Rotated rectangle, and Polygon. Draw,
  move, resize (corner handles), rotate, and reshape (vertex handles) directly
  on the canvas.
- **Wall / Ceiling views** — switch between a wall-mounted cross-section and a
  ceiling-mounted top-down footprint; geometry re-projects accordingly.
- **Context properties panel** — edit the selected zone (name, type, geometry,
  rotation, live occupancy) or sensor settings.
- **Light / Dark themes**, plus dirty-state tracking with **Apply** / **Revert**.

## Tech stack

- [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vite.dev/) for dev server and bundling
- SVG canvas with pointer-event interaction; no other runtime dependencies

## Getting started

```bash
npm install
npm run dev      # start the dev server (http://localhost:5173)
```

Other scripts:

```bash
npm run build      # type-check (tsc) + production build to dist/
npm run preview    # preview the production build
npm run typecheck  # type-check only
```

## Project structure

```
index.html               # entry; loads Murecho + JetBrains Mono fonts
DECISIONS.md             # locked architecture decisions (roadmap §3)
src/
  main.tsx               # React entry point
  ZoneStudio.tsx         # app shell: lays the panels around the canvas
  domain/                # canonical data model + pure logic
    types.ts             #   TypeScript model (Room/Device/Sensor/Zone/…)
    schema.json          #   matching JSON Schema (persistence contract)
    geometry.ts          #   pure zone geometry (rect corners, point-in-poly, …)
    profile.ts           #   NATIVE vs POLYGON profile resolution
    constants.ts         #   physical sensor facts (FoV, range)
  client/                # the integration seam
    ZonesClient.ts       #   interface: discover / read / write / stream targets
    MockZonesClient.ts   #   mock data + live-target simulation (Phase 0)
  store/                 # small typed store
    store.ts             #   state + actions + drag interaction
    instance.ts          #   composition root (wires client → store)
    hooks.ts             #   useEditorState() binding
  canvas/                # the SVG canvas
    Canvas.tsx           #   range rings, FoV, band, zones, targets, trails
    CanvasToolbar.tsx    #   view + tool selectors, cursor readout
    projection.ts        #   metre ↔ pixel projection per view
    constants.ts         #   viewbox / scale display constants
  panels/                # side panels
    TopBar.tsx           #   logo, room status, theme, apply/revert
    LeftPanel.tsx        #   layers + zone list
    Inspector.tsx        #   right context panel (routes by selection)
    ZonePanel.tsx        #   zone editor (geometry, type)
    BandPanel.tsx        #   SEN0609 radial band editor
    LdPanel.tsx          #   LD2450 sensor / live targets
  components/Field.tsx   # controlled-on-commit input
  index.css              # global reset + full-viewport sizing
  styles/zonestudio.css  # theme tokens (light/dark), scrollbars, keyframes
  lib/css.ts             # inline CSS-string → React style-object helper
```

## Architecture

PR #4 delivered the prototype as one ~1500-line class component. Phase 0 (see
[DECISIONS.md](./DECISIONS.md)) split it into layers without any user-visible
change, so later phases (backend, Home Assistant connection, real apply path)
have a stable contract to build on:

- **`domain/`** — the canonical data model (`types.ts` + matching `schema.json`)
  plus pure, dependency-free logic: geometry (copied verbatim, keeping the canvas
  pixel-identical) and the NATIVE/POLYGON profile resolver.
- **`client/`** — the `ZonesClient` seam (discover / read / write / stream
  targets). Phase 0 ships only `MockZonesClient`, which owns all of today's
  simulated data and the live-target animation. A real backend swaps in here
  without the UI changing.
- **`store/`** — a small typed store (state + actions + drag interaction),
  consumed via `useSyncExternalStore`; no new runtime dependencies.
- **`canvas/` + `panels/`** — the SVG canvas and side panels. Inline style strings
  from the prototype are still fed through `lib/css.ts` rather than
  hand-translated, to avoid visual drift.

Intentional, behaviour-preserving choices:

- The root frame fills the viewport (the prototype hard-coded 1440×900). At that
  resolution the layout is identical; the flex layout and SVG `viewBox` scale
  gracefully at other sizes.
- Text and number fields commit on blur / Enter (matching the prototype's native
  `change` semantics) while range sliders update live.
- The header (“Living Room · 2 sensors”) is derived from the room/device model,
  not hardcoded, so multi-room is a later UI addition rather than a schema change.
