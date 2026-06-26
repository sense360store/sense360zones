# Sense360 Zone Studio — Roadmap

The delivery plan, by phase. Earlier phases are locked; later phases describe
intent and may change. The locked architecture decisions live in
[DECISIONS.md](./DECISIONS.md).

## Phase 0 — Data model and seams (done)

Split the prototype into layers without any user visible change: the canonical
data model (`domain/`), the `ZonesClient` seam with a mock implementation
(`client/`), a typed store (`store/`), and the SVG canvas and panels. This gave
every later phase a stable contract to build on.

## Phase 1 — Add-on shell (done)

Package the app as a Home Assistant add-on that installs from the sidebar and
runs against a real backend, still serving mock data. A Fastify server serves the
single page application and exposes the data contract over HTTP and a WebSocket;
a server side `MockDataProvider` reproduces the simulation. The frontend gains an
`HttpZonesClient` that satisfies the existing client contract, so the swap is
transparent to the UI. Ingress, multi architecture image builds, and CI are set
up here. No hardware is touched.

## Phase 2 — Home Assistant data provider (this release)

Replace only the backend's data provider with one that talks to Home Assistant.
An `HaDataProvider` connects to the Home Assistant WebSocket API, discovers
ESPHome devices and entities, maps them to the room, device, and sensor model,
and streams live LD2450 targets through the existing contract. The frontend gains
a real room and device picker, honest connection states, and persisted mount. It
is read only, and is verified against a WebSocket simulator since the loop cannot
reach real hardware. The routes and the client contract do not change.

## Phase 3 — Apply path

Write authored zones to the device and enforce the native LD2450 constraints (at
most three axis aligned rectangles under one mode), falling back to the polygon
profile otherwise (DECISIONS.md §3.1).

## Phase 4 — Polygon profile

Generate an ESPHome package for polygon zones with a runtime point in polygon
preview, and drive the profile switch UX (DECISIONS.md §3.1, §3.2).

## Phase 5 — SEN0609 / C4001 component

Back the full radial band editor with a dedicated ESPHome component covering
distance, configurable range, and trigger and sustained sensitivity
(DECISIONS.md §3.3).
