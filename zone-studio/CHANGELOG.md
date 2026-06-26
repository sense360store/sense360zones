# Changelog

All notable changes to this add-on are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.3.0]: https://github.com/sense360store/sense360zones/releases/tag/v0.3.0
[0.2.0]: https://github.com/sense360store/sense360zones/releases/tag/v0.2.0
[0.1.0]: https://github.com/sense360store/sense360zones/releases/tag/v0.1.0
