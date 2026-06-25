# Sense360 Add-ons

A Home Assistant add-on repository for Sense360. It currently contains one
add-on, **Sense360 Zone Studio**, in [`zone-studio/`](./zone-studio).

## Add this repository to Home Assistant

In Home Assistant, open Settings then Add-ons, open the Add-on Store, and from
the overflow menu choose Repositories. Add:

```
https://github.com/sense360store/sense360zones
```

Sense360 Zone Studio then appears in the store. Install it, start it, and open it
from the sidebar.

## Sense360 Zone Studio

An interactive radar and sensor zone configuration studio for Sense360 rooms. Lay
out detection and exclusion zones over a live canvas, tune sensor range bands, and
watch tracked targets move. It supports the HLK LD2450 (spatial X/Y tracking, owns
the drawable zones) and the DFRobot SEN0609 / C4001 (radial range band).

This is the Phase 1 add-on shell. The data is still simulated, but it now flows
through the real architecture: the frontend talks to a backend over HTTP and a
WebSocket, the app is packaged as an installable add-on, and a multi architecture
image is built in CI. A later phase replaces only the backend's data provider with
a real Home Assistant connection. See [ROADMAP.md](./ROADMAP.md) and
[DECISIONS.md](./DECISIONS.md).

User facing documentation is in [`zone-studio/DOCS.md`](./zone-studio/DOCS.md).

## Architecture

The frontend and the backend meet at a single, stable client contract, so the
running app cannot tell a mock from a real backend.

- **`zone-studio/src/domain/`** — the canonical data model (`types.ts` plus a
  matching `schema.json`) and pure logic: geometry and the NATIVE/POLYGON profile
  resolver. Everything is SI units (metres, degrees) in room coordinates.
- **`zone-studio/src/client/`** — the `ZonesClient` seam: discover, read and write
  config, and stream live targets. `HttpZonesClient` is the live implementation
  (HTTP plus WebSocket, ingress relative URLs); `MockZonesClient` stays for tests
  and offline development.
- **`zone-studio/src/store/`** — a small typed store consumed via
  `useSyncExternalStore`. `store/instance.ts` is the single composition root that
  wires the client to the store.
- **`zone-studio/src/canvas/` and `zone-studio/src/panels/`** — the SVG canvas,
  projection math, toolbar, and side panels. `ZoneStudio.tsx` is layout only.
- **`zone-studio/server/`** — a Fastify backend that serves the built SPA and
  exposes the same contract. A server side `DataProvider` interface has a
  `MockDataProvider` that owns the simulation; a later phase adds an
  `HaDataProvider` and changes only the provider selection.

### Ingress

Home Assistant serves the add-on under `/api/hassio_ingress/<token>/`. The build
uses relative asset URLs (`base: './'`) and the client builds every API and
WebSocket URL from the document's own path, so the browser carries the ingress
prefix and the add-on never emits an absolute, prefix less path. The server only
admits the Supervisor ingress peer in production.

## Development

All development happens inside `zone-studio/`.

```bash
cd zone-studio
npm ci
npm run dev        # Vite on :5173 and the backend on :8099, proxied together
```

Other scripts:

```bash
npm run build        # typecheck, build the SPA, bundle the server
npm run typecheck    # type-check the frontend and the server
npm test             # unit and integration tests (Vitest)
npm run lint         # ESLint
npm run start        # run the bundled server (after build)
```

To build and run the add-on image locally:

```bash
cd zone-studio
docker build --build-arg BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.21 -t zone-studio .
docker run --rm -e ALLOW_ALL_ORIGINS=1 -p 8099:8099 zone-studio
# then open http://localhost:8099
```

`ALLOW_ALL_ORIGINS=1` disables the ingress peer guard for local use only.
