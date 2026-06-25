# Changelog

All notable changes to this add-on are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/sense360store/sense360zones/releases/tag/v0.1.0
