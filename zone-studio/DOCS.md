# Sense360 Zone Studio

Configure radar detection and exclusion zones over a live canvas for HLK LD2450
and DFRobot SEN0609 sensors, from the Home Assistant sidebar.

## What this add-on does

Zone Studio opens through Home Assistant ingress, so it is reachable from the
sidebar with no extra port or login. It serves a single page application backed
by a small server.

The server connects to Home Assistant and shows your real sensors. It discovers
ESPHome devices and entities, lists the rooms and devices it finds in the top bar
picker, and tracks live LD2450 targets on the canvas as people move. Pick a room
and a device to view, and the canvas follows that device.

This release is read only. It does not write zones, bands, or any setting to a
device; drawing and tuning come in a later phase. The DFRobot SEN0609 is
discovered and its range band is shown as configured, but its live presence and
distance are not streamed yet.

## Connection states

The top bar shows the connection at a glance, and the canvas shows a clear
message when there is nothing to draw:

- Connecting: discovery is in progress.
- Live: Home Assistant answered and at least one sensor was found.
- No sensors: Home Assistant answered but no LD2450 or SEN0609 device was
  detected. Check that the sensors are set up in ESPHome, then retry.
- Offline: the add-on could not reach the Home Assistant WebSocket API. It keeps
  retrying in the background; use Retry to check again.

The add-on never shows simulated data in place of a real connection.

## Correcting a misdetected device

Detection is heuristic. It identifies an LD2450 by its per target x and y
coordinate entities, and a SEN0609 by its presence sensor. If a device is read
wrongly, you can override it with a record under the add-on data directory
(`/data/zone-studio.json`) that forces the device kind and the entity roles.
Auto-detection only seeds the mapping where there is no override, so your
correction persists across restarts.

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
