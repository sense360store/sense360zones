# Sense360 Zone Studio

Configure radar detection and exclusion zones over a live canvas for HLK LD2450
and DFRobot SEN0609 sensors, from the Home Assistant sidebar.

## What this add-on does

Zone Studio opens through Home Assistant ingress, so it is reachable from the
sidebar with no extra port or login. It serves a single page application backed
by a small server.

This is the Phase 1 add-on shell. The data is still simulated: the server
streams a moving set of mock targets and returns a fixed room with one device
and two sensors. The architecture is the real one, though. The frontend talks to
the backend over HTTP and a WebSocket, and a later phase replaces only the
server's data provider with a real Home Assistant connection. Nothing you do here
is written to hardware yet.

## Installation

1. In Home Assistant, open Settings then Add-ons, and open the Add-on Store.
2. From the store's overflow menu choose Repositories, and add
   `https://github.com/sense360store/sense360zones`.
3. Find Sense360 Zone Studio in the store and select Install.
4. Start the add-on, then open it from the sidebar.

## Configuration

The add-on has one option.

### Option: `log_level`

Controls how much the add-on writes to its log. One of `trace`, `debug`, `info`,
`notice`, `warning`, `error`, or `fatal`. The default is `info`. Use `debug` when
reporting a problem.

```yaml
log_level: info
```

## Networking and security

The server listens on port 8099 inside the container and is reached only through
Home Assistant ingress. In normal operation it rejects any request that does not
come from the Supervisor ingress address, so it is not exposed on your network.
There is no separate login: Home Assistant authenticates you before ingress.

## Support

Issues and questions: https://github.com/sense360store/sense360zones/issues
