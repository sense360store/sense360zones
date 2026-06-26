# Sense360 Zone Studio — Decisions

Decisions locked in **Phase 0**, resolving §3 of the delivery roadmap. Each is the
roadmap's recommended option unless noted. Later phases assume these answers.

---

## 3.1 Zone application strategy — adaptive NATIVE / POLYGON

**Decision.** Support both profiles and let the app choose **per device** based on
what the zone set needs.

- **NATIVE** — push zone rectangles straight to the LD2450 region registers
  (`zone_1`/`zone_2`/`zone_3` + region-type select). Available only when the zone
  set fits the firmware: at most **3 zones**, **all axis-aligned rectangles**,
  under **one global mode** (all detection, or all exclusion).
- **POLYGON** — keep the LD2450 reporting unfiltered and evaluate arbitrary zones
  in software / generated config. Required the moment the set includes a polygon,
  a rotated rectangle, a 4th zone, or mixes detection and exclusion.

The UI must surface the active profile and its limits, and must never silently
drop geometry the firmware cannot represent.

**Implemented in Phase 0:** `src/domain/profile.ts` — `resolveProfile(zones)`
returns `'native' | 'polygon'` plus human-readable reasons NATIVE is unavailable.
Not yet surfaced in the UI (Phase 0 makes no user-visible change).

**Updated in Phase 3:** `resolveProfile(zones, mount)` is now mount-aware and
delegates to `nativeViolations` in `src/domain/native.ts`, the single eligibility
check shared with the write path. Eligibility is judged in the sensor frame
(zone rotation combined with the mount boresight), which subsumes the earlier
`rot === 0` right-angle defect. The resolver is surfaced in the UI: the editor
shows the active profile and blocks Apply with the specific reasons. Phase 4
drives the profile-switch UX for the polygon path.

## 3.2 How POLYGON zones become entities — generated config + runtime preview

**Decision.** Two complementary outputs:

- **Canonical / durable:** generate an ESPHome package using the polygon-capable
  external component (TillFleisch `ESPHome-HLK-LD2450`), one occupancy
  `binary_sensor` per zone, pushed via the ESPHome dashboard API. Survives HA
  downtime, automation-friendly.
- **Live preview:** runtime point-in-polygon evaluation in the backend, publishing
  occupancy via MQTT discovery / HA helpers, so the user sees results while
  editing before committing a flash.

Non-convex polygons (e.g. the "Kitchen run" L) are decomposed into convex parts
at generation time, since the external component prefers convex zones. (Phase 4.)

## 3.3 SEN0609 / C4001 ESPHome support — constrain v1, build the component in Phase 5

**Decision.** For the first shippable version, constrain the band editor to what
the off-the-shelf `dfrobot_sen0395` component actually exposes (presence on/off,
basic range) and grey out the rest. A dedicated/extended `c4001` component
covering distance, configurable min/max range, and trigger/sustain sensitivity is
**Phase 5**, so it does not block the LD2450 path which is the core of the product.

*Note:* the band editor as designed (min/max radius, beam, trigger, sustained,
reduced range) is already in the data model (`BandConfig`) and UI, but its full
backing is deferred to Phase 5.

## 3.4 Canvas technology — keep SVG

**Decision.** Keep **SVG** (PR #4 shipped it; the earlier spec named Konva). It is
readable and performant at the current target count (≤3 targets ~10 Hz). Revisit
only if many simultaneous targets or multiple sensors are drawn at once. The
geometry is isolated behind `domain/geometry.ts` + `canvas/projection.ts`, so a
future renderer swap does not touch the data model.

## 3.5 Scope of "a room" — model multi-room now, expose single-room in v1

**Decision.** Model `Room → Device → Sensor` properly in the data layer from
Phase 0 even though the v1 UI exposes one room, so multi-room becomes a UI
addition later rather than a schema migration.

**Implemented in Phase 0:** `src/domain/types.ts` defines the full hierarchy; the
header is derived from the model (room name + sensor count) rather than hardcoded.

---

## Phase 0 implementation notes

- **Canonical model:** `src/domain/types.ts` (TypeScript) + `src/domain/schema.json`
  (JSON Schema, draft 2020-12). Keep the two in sync. This is the contract every
  later phase reads/writes (backend persistence, HA discovery, the apply path).
- **The seam:** `src/client/ZonesClient.ts` defines `discover` / `readConfig` /
  `writeConfig` / `streamTargets`. `MockZonesClient` is the only implementation in
  Phase 0; it owns all of today's simulated data and the live-target animation.
  Swapping in a real backend touches only `src/store/instance.ts`.
- **Store:** `src/store/store.ts` is a small typed store (state + actions + drag
  interaction), consumed via `useSyncExternalStore`. No new runtime dependencies.
- **Module layout:** `domain/` (model, geometry, profile) · `client/` (seam + mock)
  · `store/` · `canvas/` (SVG + projection) · `panels/` (top bar, layer/zone list,
  inspector). `ZoneStudio.tsx` is now just layout.
- **One intentional behaviour nuance:** the mock target simulation is now
  *view-agnostic* — targets bounce within the LD2450's physical field of view, so
  the wall view is identical to PR #4 and the (non-default) ceiling view shows the
  same physical targets in the forward cone rather than the full disc. This keeps
  the `ZonesClient` seam free of UI-view concerns.
