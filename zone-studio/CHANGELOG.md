# Changelog

All notable changes to this add-on are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.2] - 2026-07-01

### Changed

- A visual and layout pass. The UI was ported from a fixed 1440 by 900 design
  artboard and did not adapt to the ingress iframe; it is now fluid at any width.
  The app root fills the iframe, the left panel, the canvas and the inspector
  reflow as width shrinks, and below the drawer breakpoint the side panels slide
  over the canvas behind Layers and Inspect toggles instead of squeezing or
  overlapping it. The canvas scales to its container and keeps its aspect, so the
  pointer to metre mapping stays exact.
- The styling is consolidated into design tokens: CSS variables for colour, a
  type scale, spacing and radii, per theme, in one stylesheet. The prototype's
  inline styles are gone; components carry classes and pass only dynamic values
  (zone accents, live coordinates) through custom properties. Both the light and
  dark themes read from the same tokens and the theme toggle is unchanged.
- Murecho and JetBrains Mono are bundled locally as woff2 files instead of being
  loaded from the Google Fonts CDN, so the editor renders correctly on an
  installation with no internet access.
- UI copy no longer breaks sentences with dashes; the affected strings use
  colons, commas, or separate sentences.

### Fixed

- The top-right collision between the inspector, the coordinate readout and the
  grid readout. The live cursor and grid readouts moved into a HUD pinned to the
  bottom-left corner of the canvas, out of every panel's way.
- The mount legend ("Wall: coverage fans across the room") wrapping one word per
  line; it now sits in a single-line chip and the toolbar wraps as a whole.
- Canvas label collisions. Range ring labels moved to the left of the centre
  line and the boresight label to the right of the line end, every canvas label
  renders on a halo of the canvas colour so grid lines never strike through the
  text, labels keep a constant on-screen size as the canvas scales, and a
  small canvas shows a ring label only every second ring.

## [0.4.1] - 2026-06-27

### Changed

- Discovery is scoped to real radar candidates. Candidate devices are restricted to
  ESPHome devices, identified by an `['esphome', node]` entry in the device
  registry, instead of any device with a presence, occupancy or motion
  binary_sensor. This alone removes person and pet trackers, phones, and Zigbee or
  Z-Wave motion sensors, so a cat tracker no longer appears as a SEN0609.
- The SEN0609 match is tightened to the DFRobot radar signature: a presence
  binary_sensor together with a distance sensor on the same device. A lone
  presence, occupancy or motion sensor never classifies a device. Detection runs on
  a device's own entities, so an ESP that carries a radar plus unrelated modules
  (air quality, fans) is classified by its radar entities and the rest is ignored.
- A device is treated as an LD2450 or SEN0609 only when the user has confirmed it
  or a confident radar entity signature is present. ESPHome candidates with no
  signature are offered for confirmation rather than silently mapped.
- The left panel layers and the canvas follow the selected device's real detected
  sensors. A device shows only the layers it has, a device that carries both an
  LD2450 and a SEN0609 renders both, and a device with no confirmed radar sensor
  shows a prompt to confirm or correct the mapping instead of empty scenery.

### Added

- A device mapping and confirmation surface. From the picker the operator can open
  a device, see the radar entities matched to each role with a confidence
  indicator, confirm the device as an LD2450 or SEN0609, correct any role, or
  dismiss the device as not a radar sensor. Confirmations, corrections and
  dismissals persist through the existing mapping override, so a dismissed device
  stays hidden and a confirmed device stays mapped across restarts.
- An optional Sense360 pre-filter. When at least one ESPHome device declares a
  recognisable Sense360 identity in its manufacturer or model (configurable through
  `SENSE360_MATCH`), discovery prefers those devices and marks them as known
  Sense360 hardware. Firmware does not declare one today, so discovery falls back to
  the full ESPHome candidate list until it does. Each candidate's name,
  manufacturer and identifiers are logged so the operator can see what their devices
  report.

## [0.4.0] - 2026-06-26

### Added

- The polygon profile. Arbitrary polygons, rotated rectangles, more than three
  zones, and a per-zone mix of detection and exclusion now apply, instead of
  being blocked. Apply puts the LD2450 into report-all mode (regions cleared,
  zone_type disabled) so the add-on sees every target.
- Live occupancy over MQTT. For a polygon device the backend evaluates each zone
  and a derived device presence against the live target stream in software and
  publishes a binary_sensor per zone, plus a presence sensor, through retained
  MQTT discovery. Transitions are debounced with a small on and off delay so an
  edge flicker does not toggle an entity. This is instant and needs no flash.
- A shared occupancy primitive in the domain layer. One pure evaluator powers both
  the live canvas highlight on the client and the published entities on the
  backend, using the Phase 0 room frame and a non-convex-safe point-in-polygon
  test, so an L-shaped zone evaluates correctly on both sides.
- Device presence semantics. A target is counted when it is inside any detection
  zone, or anywhere in range when there are no detection zones, and never when it
  is inside an exclusion zone, so exclusion zones subtract from presence.
- Retained discovery with availability. Entities carry an availability topic and
  the add-on sets a last will, so they show unavailable when the add-on stops
  rather than disappearing, and a zone's discovery config is cleared when the zone
  is deleted.
- Generated ESPHome config. A Generate ESPHome config action turns the drawn zones
  into a package for the TillFleisch ESPHome-HLK-LD2450 component (pinned to
  v1.0.6), with an occupancy binary sensor per zone and each non-convex zone split
  into convex parts. The YAML can be copied or downloaded; flashing is a manual,
  documented step.
- Live canvas preview. A zone lights up the moment a target enters it, from the
  same shared evaluator the backend publishes from, independent of the round trip
  through Home Assistant.
- The `mqtt:want` service, so the Supervisor grants the broker connection.

### Changed

- Source of truth is profile-aware. For a native set the hardware registers remain
  the truth, as before. For a polygon set the device is in report-all mode and the
  add-on's persisted active config is the truth; readConfig and Revert follow that
  rule per profile.
- Apply is no longer blocked for a non-native set. The editor explains that
  occupancy now comes from the add-on's live evaluation published over MQTT, that
  the device reports all targets, and that the generated config is the durable
  option, reusing the resolver reasons from Phase 3.

### Notes

- Degrades clearly. If the MQTT integration is not available the canvas preview
  still works and the editor states that MQTT is required to publish the polygon
  zone entities; the device is not failed.
- Polygon zones are an LD2450 capability. SEN0609 stays editable and persisted with
  no register writes and no live presence, as in Phase 3.
- No automatic push or flash to a device or the ESPHome dashboard. Generating the
  config is built and tested here; adding it to the device and flashing is manual.

## [0.3.0] - 2026-06-26

### Added

- Native LD2450 zone apply. Draw up to three axis-aligned rectangles under one
  mode, hit Apply, and the backend writes the per-zone region numbers and the
  global zone_type select on the device, then reads them back to confirm the
  device accepted the values. The per-zone target count and presence entities
  react to the new regions.
- Device-truth read and Revert. The backend reconstructs zones from the live
  region entities and the zone_type select, so Revert returns the editor to what
  the hardware actually holds, and the dirty indicator reflects the true
  difference between the editor and the device.
- Apply guardrails. The editor surfaces the active profile and, when a set cannot
  go to the device natively, the specific reasons (more than three zones, a
  rotated or polygon zone, mixed modes, a region out of range, overlapping
  regions), and blocks Apply rather than dropping geometry.
- Region geometry and validation. A room to sensor transform and a region mapping
  with millimetre output, plus a single native constraint check shared by the
  profile resolver and the write path.
- Persistence of the authored zones and the SEN0609 band, alongside the existing
  mount and mapping. The device remains the source of truth for Revert.

### Fixed

- The right-angle defect in profile resolution. Eligibility is now judged in the
  sensor frame, combining the zone rotation with the mount boresight, so a
  rectangle at 90, 180, or 270 degrees is native-eligible rather than forced onto
  the polygon path, and the boresight is no longer ignored.

### Notes

- LD2450 native zones only. SEN0609 settings stay editable and persist app side;
  no SEN0609 registers are written to a device, and its live presence is not
  streamed yet. Both belong to later phases.
- Some LD2450 firmware does not retain zones across a power cycle. That is a
  firmware quirk, not an add-on fault. See DOCS.md for the workaround.

## [0.2.0] - 2026-06-25

### Added

- Home Assistant data provider. The backend connects to the Home Assistant
  WebSocket API, discovers ESPHome devices and entities, maps them to the room,
  device and sensor model, and streams live LD2450 targets onto the canvas. The
  data contract and the frontend are unchanged.
- A small Home Assistant WebSocket client with the auth handshake, request and
  response correlation, subscriptions, and reconnect with backoff so the add-on
  survives a Home Assistant restart.
- Sensor detection for the LD2450 (per target x and y coordinates) and the
  SEN0609 (presence sensor). A persisted mapping override in the data directory
  corrects a device the heuristics misread.
- A room and device picker driven by discovery, and honest connection states
  (connecting, connected, no devices found, offline). The production path never
  shows simulated data for a real failure.
- Per device mount persistence. The mount is calibration kept app side and
  round-trips through the config payload; it is not written to hardware.
- Provider selection from the PROVIDER environment variable, defaulting to the
  Home Assistant provider. The mock provider stays available for development and
  the container smoke test.
- A Home Assistant WebSocket simulator and fixtures, the provider test suite, and
  a continuous integration job that runs the runtime container against the
  simulator with PROVIDER=ha.

### Notes

- Read only. No zones, bands, or registers are written to a device in this
  release. SEN0609 live presence and distance streaming are deferred; its band is
  shown as configured, not live.

### Removed

- The armv7 architecture. The Home Assistant builder no longer builds 32 bit arm,
  so the add-on now ships for aarch64 and amd64.

## [0.1.0] - 2026-06-25

### Added

- Initial add-on shell. Installs in Home Assistant and opens from the sidebar
  through ingress.
- Fastify backend that serves the single page application and exposes the data
  contract: discovery, device config read and write, and a WebSocket target
  stream.
- Server side `MockDataProvider` that reproduces the simulated room, device, and
  the bouncing target animation. The data is still mock; a later phase replaces
  only this provider.
- `HttpZonesClient` in the frontend, implementing the existing client contract
  over HTTP and WebSocket with ingress relative URLs.
- Multi architecture image build (aarch64, amd64, armv7) and continuous
  integration.

[0.4.0]: https://github.com/sense360store/sense360zones/releases/tag/v0.4.0
[0.3.0]: https://github.com/sense360store/sense360zones/releases/tag/v0.3.0
[0.2.0]: https://github.com/sense360store/sense360zones/releases/tag/v0.2.0
[0.1.0]: https://github.com/sense360store/sense360zones/releases/tag/v0.1.0
