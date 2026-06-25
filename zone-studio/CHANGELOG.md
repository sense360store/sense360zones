# Changelog

All notable changes to this add-on are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/sense360store/sense360zones/releases/tag/v0.2.0
[0.1.0]: https://github.com/sense360store/sense360zones/releases/tag/v0.1.0
