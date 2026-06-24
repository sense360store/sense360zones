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
index.html              # entry; loads Murecho + JetBrains Mono fonts
src/
  main.tsx              # React entry point
  ZoneStudio.tsx        # the Zone Studio component (state, geometry, canvas, panels)
  index.css             # global reset + full-viewport sizing
  styles/zonestudio.css # theme tokens (light/dark), scrollbars, keyframes
  lib/css.ts            # inline CSS-string → React style-object helper
```

## Implementation notes

The original prototype was authored in Claude Design's `DCLogic` framework — a
thin layer over React — so the port maps almost one-to-one onto a React class
component. The geometry math (projection, rotated-rect corners, arc paths,
point-in-polygon occupancy) is copied verbatim, which keeps the canvas
pixel-identical to the design. Inline style strings from the prototype are fed
through `lib/css.ts` rather than hand-translated, to avoid visual drift.

Two intentional, behaviour-preserving choices:

- The root frame fills the viewport (the prototype hard-coded 1440×900). At that
  resolution the layout is identical; the flex layout and SVG `viewBox` scale
  gracefully at other sizes.
- Text and number fields commit on blur / Enter (matching the prototype's native
  `change` semantics) while range sliders update live.
